// app.js — Froll.net (Connect + Swap VIC↔FROLL + Social wired with ABI)
// Ethers v5 is loaded from CDN in index.html

/* ===================== CONFIG ===================== */
const VIC_CHAIN = {
  chainId: "0x58", // 88
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: [
    "https://rpc.viction.xyz",
    "https://viction.blockpi.network/v1/rpc/public"
  ],
  blockExplorerUrls: ["https://vicscan.xyz"]
};

// === Contracts (VIC network) ===
const FROLL_ADDR = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // FROLL on VIC
const SWAP_ADDR  = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068"; // Swap FROLL/VIC
const FROLL_DECIMALS = 18;

// === Social (deployed) ===
let SOCIAL_ADDR = "0x28c642682b1E1458d922C4226a7192F5B8953A74"; // ✔ your Social contract on VIC
// ABI generated from the source you provided
const SOCIAL_ABI = [
  // Read
  "function FROLL() view returns (address)",
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function owner() view returns (address)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function posts(uint256) view returns (uint256 id, address author, string content, uint64 timestamp)",
  "function getUserPosts(address) view returns (uint256[] memory)",
  "function getPost(uint256) view returns (tuple(uint256 id, address author, string content, uint64 timestamp))",

  // Write
  "function register()",
  "function createPost(string calldata content) returns (uint256 id)",
  "function tipPost(uint256 postId, uint256 amount)",

  // Admin
  "function setRegisterFee(uint256 newFee)",
  "function transferOwnership(address newOwner)",
  "function withdrawTreasury(address to, uint256 amount)",

  // Events
  "event Registered(address indexed user, uint256 feePaid)",
  "event PostCreated(uint256 indexed id, address indexed author, uint64 timestamp)",
  "event PostTipped(uint256 indexed id, address indexed from, address indexed to, uint256 amount)",
  "event RegisterFeeUpdated(uint256 oldFee, uint256 newFee)",
  "event OwnerChanged(address indexed oldOwner, address indexed newOwner)",
  "event TreasuryWithdrawn(address indexed to, uint256 amount)"
];

// Fixed rate & fee (swap contract)
const FIXED_RATE = 100;     // 1 FROLL = 100 VIC
const TX_FEE_VIC = 0.01;    // 0.01 VIC (display only)

/* ===================== ABIs ===================== */
const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const SWAP_ABI = [
  "function swapVicToFroll() payable",
  "function swapFrollToVic(uint256 frollAmount) returns (bool)",
  "function getContractBalances() view returns (uint256 vicBalance, uint256 frollBalance)"
];

/* ===================== STATE ===================== */
let provider, signer, account, froll, swap, social;
let currentDir = "VIC2FROLL";

/* ===================== DOM ===================== */
const els = {
  connectBtn: document.getElementById("connect-wallet"),
  badge:      document.getElementById("wallet-badge"),
  fromToken:  document.getElementById("from-token"),
  toToken:    document.getElementById("to-token"),
  fromAmt:    document.getElementById("from-amount"),
  toAmt:      document.getElementById("to-amount"),
  btnMax:     document.getElementById("btn-max"),
  approve:    document.getElementById("approve-froll"),
  swapNow:    document.getElementById("swap-now"),
  fromBal:    document.getElementById("from-balance"),
  toBal:      document.getElementById("to-balance"),
  tabs:       document.querySelectorAll(".tab-btn"),
  estGas:     document.getElementById("est-gas"),
  msg:        document.getElementById("swap-msg"),

  // Social
  socialGate: document.getElementById("social-not-connected"),
  socialBox:  document.getElementById("social-connected"),
  socialMsg:  document.getElementById("social-msg"),
  btnCreate:  document.getElementById("btn-create-profile"),
  btnPublish: document.getElementById("btn-publish"),
  txtPost:    document.getElementById("post-content"),
  btnFollow:  document.getElementById("btn-follow"),
  btnLike:    document.getElementById("btn-like"),
  btnShare:   document.getElementById("btn-share"),
  inpFollow:  document.getElementById("follow-addr"),
  inpLikeId:  document.getElementById("like-postid"),
  inpShareId: document.getElementById("share-postid"),
};

/* ===================== HELPERS ===================== */
const fmt = (n, d = 4) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (addr = "") => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "");

function setBadge(text, ok = false) {
  if (!els.badge) return;
  els.badge.textContent = text;
  els.badge.style.background = ok ? "#ecfdf5" : "#f3f4f6";
  els.badge.style.color = ok ? "#065f46" : "#374151";
  els.badge.style.borderColor = ok ? "#a7f3d0" : "#e5e7eb";
}
function setConnecting(b) {
  if (!els.connectBtn) return;
  els.connectBtn.disabled = b;
  els.connectBtn.textContent = b ? "Connecting…" : "Connect Wallet";
}
function setMsg(text, ok = false) {
  if (!els.msg) return;
  els.msg.textContent = text;
  els.msg.style.color = ok ? "#065f46" : "#374151";
}
function parseSafeFloat(v) {
  const x = parseFloat(v);
  return isFinite(x) && x >= 0 ? x : 0;
}

/* ===================== NETWORK / WALLET ===================== */
async function ensureVictionSelected(eth) {
  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === VIC_CHAIN.chainId) return true;

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN.chainId }] });
    return true;
  } catch (err) {
    if (err?.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_CHAIN] });
      return true;
    }
    throw err;
  }
}

async function connect() {
  const eth = window.ethereum;
  if (!eth) {
    alert("MetaMask not detected. Please install MetaMask and try again.");
    return;
  }
  setConnecting(true);
  setBadge("Connecting…");

  try {
    await ensureVictionSelected(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    account = await signer.getAddress();

    // Init contracts
    froll = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    swap  = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);

    setBadge(`Connected: ${shorten(account)}`, true);

    // UI gates
    if (els.socialGate && els.socialBox) {
      els.socialGate.style.display = "none";
      els.socialBox.style.display = "block";
    }

    await refreshBalances();
    updateOutput();
    estimateGasSafe().catch(() => {});
  } catch (err) {
    if (err?.code === 4001) {
      setBadge("Connect rejected. Please approve MetaMask.");
      alert("Connect failed. Please approve wallet requests in MetaMask.");
    } else {
      console.error("Connect error:", err);
      setBadge("Connect failed. Check MetaMask & network.");
      alert("Connect failed. Please approve wallet requests and ensure Viction (chainId 88).");
    }
  } finally {
    setConnecting(false);
  }
}

if (els.connectBtn) els.connectBtn.addEventListener("click", connect);

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accs) => {
    if (accs && accs.length > 0) {
      account = accs[0];
      setBadge(`Connected: ${shorten(account)}`, true);
      refreshBalances();
    } else {
      location.reload();
    }
  });
  window.ethereum.on?.("chainChanged", (chainId) => {
    if (chainId?.toLowerCase() !== VIC_CHAIN.chainId) {
      setBadge("Wrong network. Switching…");
      ensureVictionSelected(window.ethereum).catch(() => {
        setBadge("Please switch to Viction (88)");
      });
    } else {
      refreshBalances();
    }
  });
}

/* ===================== SWAP LOGIC ===================== */
function setDirection(dir) {
  currentDir = dir;
  els.tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.dir === dir));
  if (dir === "VIC2FROLL") {
    els.fromToken.textContent = "VIC";
    els.toToken.textContent = "FROLL";
    els.approve.style.display = "none";
  } else {
    els.fromToken.textContent = "FROLL";
    els.toToken.textContent = "VIC";
  }
  els.fromAmt.value = "";
  els.toAmt.value = "";
  updateBalancesLabels();
  updateOutput();
  estimateGasSafe().catch(() => {});
}
els.tabs?.forEach(btn => btn.addEventListener("click", () => setDirection(btn.dataset.dir)));

function updateOutput() {
  const v = parseSafeFloat(els.fromAmt.value);
  if (!v) return (els.toAmt.value = "");
  if (currentDir === "VIC2FROLL") {
    const frollGot = v / FIXED_RATE;
    els.toAmt.value = fmt(frollGot, 6);
  } else {
    const vicGot = v * FIXED_RATE;
    els.toAmt.value = fmt(vicGot, 6);
  }
}

async function refreshBalances() {
  if (!provider || !account) {
    els.fromBal.textContent = "Balance: –";
    els.toBal.textContent = "Balance: –";
    return;
  }
  try {
    const vicBalWei = await provider.getBalance(account);
    const vicBal = parseFloat(ethers.utils.formatEther(vicBalWei));
    const frollBalRaw = await froll.balanceOf(account);
    const frollBal = parseFloat(ethers.utils.formatUnits(frollBalRaw, FROLL_DECIMALS));

    if (currentDir === "VIC2FROLL") {
      els.fromBal.textContent = `Balance: ${fmt(vicBal)} VIC`;
      els.toBal.textContent   = `Balance: ${fmt(frollBal, 6)} FROLL`;
    } else {
      els.fromBal.textContent = `Balance: ${fmt(frollBal, 6)} FROLL`;
      els.toBal.textContent   = `Balance: ${fmt(vicBal)} VIC`;
    }
  } catch (e) {
    console.warn("Balance refresh failed:", e);
  }
}
function updateBalancesLabels() {
  if (!account) {
    els.fromBal.textContent = "Balance: –";
    els.toBal.textContent = "Balance: –";
  }
}

els.fromAmt?.addEventListener("input", async () => {
  updateOutput();
  if (currentDir === "FROLL2VIC") await maybeToggleApproveBtn();
  estimateGasSafe().catch(() => {});
});

els.btnMax?.addEventListener("click", async () => {
  if (!provider || !account) return;
  if (currentDir === "VIC2FROLL") {
    const vicWei = await provider.getBalance(account);
    let vic = parseFloat(ethers.utils.formatEther(vicWei));
    vic = Math.max(0, vic - 0.02); // leave ~0.02 VIC for gas + 0.01 fee
    els.fromAmt.value = vic > 0 ? vic.toFixed(6) : "";
  } else {
    const balRaw = await froll.balanceOf(account);
    const fr = parseFloat(ethers.utils.formatUnits(balRaw, FROLL_DECIMALS));
    els.fromAmt.value = fr > 0 ? fr.toFixed(6) : "";
  }
  updateOutput();
  if (currentDir === "FROLL2VIC") await maybeToggleApproveBtn();
  estimateGasSafe().catch(() => {});
});

// Approve for FROLL → VIC
async function maybeToggleApproveBtn() {
  try {
    if (!account) return (els.approve.style.display = "none");
    const need = parseSafeFloat(els.fromAmt.value);
    if (!need) return (els.approve.style.display = "none");
    const needUnits = ethers.utils.parseUnits(String(need), FROLL_DECIMALS);

    const allowance = await froll.allowance(account, SWAP_ADDR);
    els.approve.style.display = allowance.lt(needUnits) ? "inline-block" : "none";
  } catch {
    els.approve.style.display = "none";
  }
}

els.approve?.addEventListener("click", async () => {
  try {
    if (!signer) await connect();
    const need = parseSafeFloat(els.fromAmt.value);
    if (!need) return alert("Enter FROLL amount first.");
    const needUnits = ethers.utils.parseUnits(String(need), FROLL_DECIMALS);
    setMsg("Approving FROLL…");
    const tx = await froll.approve(SWAP_ADDR, needUnits);
    await tx.wait();
    setMsg("Approve successful ✔", true);
    await maybeToggleApproveBtn();
  } catch (e) {
    console.error(e);
    setMsg("Approve failed.");
    alert("Approve failed or rejected.");
  }
});

// Swap
els.swapNow?.addEventListener("click", async () => {
  try {
    if (!signer) await connect();
    const v = parseSafeFloat(els.fromAmt.value);
    if (!v) return alert("Enter amount first.");

    setMsg("Preparing transaction…");

    if (currentDir === "VIC2FROLL") {
      const vicToSend = ethers.utils.parseEther(String(v));
      const tx = await swap.swapVicToFroll({ value: vicToSend });
      setMsg(`Swapping VIC→FROLL… (tx ${tx.hash.slice(0,10)}…)`);
      await tx.wait();
      setMsg("Swap VIC→FROLL successful ✔", true);
    } else {
      const frollAmt = ethers.utils.parseUnits(String(v), FROLL_DECIMALS);
      const allowance = await froll.allowance(account, SWAP_ADDR);
      if (allowance.lt(frollAmt)) return alert("Please Approve FROLL first, then Swap.");
      const tx = await swap.swapFrollToVic(frollAmt);
      setMsg(`Swapping FROLL→VIC… (tx ${tx.hash.slice(0,10)}…)`);
      await tx.wait();
      setMsg("Swap FROLL→VIC successful ✔", true);
    }

    els.fromAmt.value = "";
    els.toAmt.value = "";
    await refreshBalances();
  } catch (e) {
    console.error(e);
    setMsg("Swap failed.");
    const msg = (e?.data?.message || e?.message || "").toString();
    if (msg.toLowerCase().includes("insufficient")) {
      alert("Swap failed: insufficient balance/allowance/liquidity.");
    } else {
      alert("Swap failed. Please check details in MetaMask & try again.");
    }
  }
});

/* Gas estimate (best-effort) */
async function estimateGasSafe() {
  if (!swap || !account) { els.estGas.textContent = "Estimated Gas: ~"; return; }
  try {
    const v = parseSafeFloat(els.fromAmt.value);
    if (!v) { els.estGas.textContent = "Estimated Gas: ~"; return; }

    if (currentDir === "VIC2FROLL") {
      const value = ethers.utils.parseEther(String(v));
      const g = await swap.estimateGas.swapVicToFroll({ value });
      els.estGas.textContent = `Estimated Gas: ~${fmt(g.toString(), 0)} units`;
    } else {
      const amt = ethers.utils.parseUnits(String(v), FROLL_DECIMALS);
      const g = await swap.estimateGas.swapFrollToVic(amt);
      els.estGas.textContent = `Estimated Gas: ~${fmt(g.toString(), 0)} units`;
    }
  } catch {
    els.estGas.textContent = "Estimated Gas: ~";
  }
}

/* ===================== SOCIAL (WIRED) ===================== */
function ensureSocialReady() {
  if (!SOCIAL_ADDR) {
    alert("Social contract address is missing.");
    if (els.socialMsg) els.socialMsg.textContent = "Paste SOCIAL_ADDR in app.js to enable Social.";
    return false;
  }
  if (!social) {
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer || provider);
  }
  return true;
}
async function ensureRegistered() {
  if (!ensureSocialReady()) return false;
  if (!account) await connect();
  const reg = await social.isRegistered(account);
  return !!reg;
}

// Create Account: auto-approve registerFee (nếu thiếu) rồi register()
els.btnCreate?.addEventListener("click", async () => {
  try {
    if (!signer) await connect();
    if (!ensureSocialReady()) return;

    const already = await social.isRegistered(account);
    if (already) return alert("You are already registered!");

    const fee = await social.registerFee();
    const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    const allowance = await erc.allowance(account, SOCIAL_ADDR);
    if (allowance.lt(fee)) {
      const tx1 = await erc.approve(SOCIAL_ADDR, fee);
      await tx1.wait();
    }
    const tx = await social.register();
    alert(`Registering… tx: ${tx.hash}`);
    await tx.wait();
    alert("Registered successfully ✔");
  } catch (e) {
    console.error(e); alert("Register failed.");
  }
});

// Publish post
els.btnPublish?.addEventListener("click", async () => {
  try {
    if (!signer) await connect();
    if (!ensureSocialReady()) return;

    const ok = await ensureRegistered();
    if (!ok) return alert("Please create an account first.");

    const content = (els.txtPost?.value || "").trim();
    if (!content) return alert("Enter post content first.");

    const maxBytes = await social.MAX_POST_BYTES();
    const enc = new TextEncoder().encode(content);
    if (enc.length > Number(maxBytes)) {
      return alert(`Content too large. Max ${maxBytes} bytes.`);
    }

    const tx = await social.createPost(content);
    alert(`Publishing… tx: ${tx.hash}`);
    await tx.wait();
    alert("Post published ✔");
    els.txtPost.value = "";
  } catch (e) {
    console.error(e); alert("Publish failed.");
  }
});

// Like button = Tip (vì hợp đồng không có like/follow/share)
els.btnLike?.addEventListener("click", async () => {
  try {
    if (!signer) await connect();
    if (!ensureSocialReady()) return;

    const ok = await ensureRegistered();
    if (!ok) return alert("Please create an account first.");

    const postId = parseInt(els.inpLikeId?.value || "0", 10);
    if (!(postId > 0)) return alert("Enter a valid Post ID.");

    const amountStr = prompt("Enter tip amount in FROLL (e.g., 0.01):", "0.01");
    const amount = parseSafeFloat(amountStr);
    if (!amount) return;

    const amountUnits = ethers.utils.parseUnits(String(amount), FROLL_DECIMALS);
    const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    const allowance = await erc.allowance(account, SOCIAL_ADDR);
    if (allowance.lt(amountUnits)) {
      const tx1 = await erc.approve(SOCIAL_ADDR, amountUnits);
      await tx1.wait();
    }

    const tx = await social.tipPost(postId, amountUnits);
    alert(`Tipping… tx: ${tx.hash}`);
    await tx.wait();
    alert("Tip sent ✔");
  } catch (e) {
    console.error(e); alert("Tip failed.");
  }
});

// Follow & Share: not supported by current contract
els.btnFollow?.addEventListener("click", () => {
  alert("Follow is not supported by the current Social contract.");
});
els.btnShare?.addEventListener("click", () => {
  alert("Share is not supported by the current Social contract.");
});

/* ===================== INIT ===================== */
setDirection("VIC2FROLL");

(async function tryWarmStart() {
  if (window.ethereum && window.ethereum.selectedAddress) {
    try { await connect(); } catch {}
  }
})();
