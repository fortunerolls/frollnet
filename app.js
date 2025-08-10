// app.js — Froll.net Social-first + Swap overlay (ethers v5 loaded via CDN)

/* ============== CONFIG ============== */
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

// Contracts (VIC)
const FROLL_ADDR  = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // FROLL (18)
const SWAP_ADDR   = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068"; // Swap FROLL/VIC
const SOCIAL_ADDR = "0x28c642682b1E1458d922C4226a7192F5B8953A74"; // FrollSocial

const FROLL_DECIMALS = 18;
const FIXED_RATE = 100;   // 1 FROLL = 100 VIC
const TX_FEE_VIC = 0.01;  // display only

/* ============== ABIs ============== */
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

// From contract source you provided
const SOCIAL_ABI = [
  // Reads
  "function FROLL() view returns (address)",
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function owner() view returns (address)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function posts(uint256) view returns (uint256 id, address author, string content, uint64 timestamp)",
  "function getUserPosts(address) view returns (uint256[] memory)",
  "function getPost(uint256) view returns (tuple(uint256 id, address author, string content, uint64 timestamp))",
  // Writes
  "function register()",
  "function createPost(string calldata content) returns (uint256 id)",
  "function tipPost(uint256 postId, uint256 amount)",
  // Admin (unused here)
  "function setRegisterFee(uint256 newFee)",
  "function transferOwnership(address newOwner)",
  "function withdrawTreasury(address to, uint256 amount)",
  // Events
  "event Registered(address indexed user, uint256 feePaid)",
  "event PostCreated(uint256 indexed id, address indexed author, uint64 timestamp)",
  "event PostTipped(uint256 indexed id, address indexed from, address indexed to, uint256 amount)"
];

/* ============== STATE ============== */
let jsonProvider;     // read-only provider (no wallet)
let provider, signer; // wallet provider & signer
let account;          // current account
let froll, swap, social;

let currentDir = "VIC2FROLL"; // swap direction

/* ============== DOM ============== */
const els = {
  // nav
  connectBtn:   document.getElementById("connect-wallet"),
  walletBadge:  document.getElementById("wallet-badge"),
  openSwapBtn:  document.getElementById("btn-open-swap"),

  // views
  homeView:     document.getElementById("home-view"),
  swapView:     document.getElementById("swap-view"),
  backBtn:      document.getElementById("swap-disconnect"),

  // compose
  composeGuard: document.getElementById("compose-guard"),
  composeArea:  document.getElementById("compose-area"),
  composeMsg:   document.getElementById("compose-msg"),
  txtPost:      document.getElementById("post-content"),
  btnCreate:    document.getElementById("btn-create-profile"),
  btnPublish:   document.getElementById("btn-publish"),

  // feed
  feedList:     document.getElementById("feed-list"),
  feedMsg:      document.getElementById("feed-msg"),
  feedAddr:     document.getElementById("feed-address"),
  btnRefresh:   document.getElementById("btn-refresh"),

  // swap elements
  tabs:         document.querySelectorAll(".tab-btn"),
  fromToken:    document.getElementById("from-token"),
  toToken:      document.getElementById("to-token"),
  fromAmt:      document.getElementById("from-amount"),
  toAmt:        document.getElementById("to-amount"),
  btnMax:       document.getElementById("btn-max"),
  fromBal:      document.getElementById("from-balance"),
  toBal:        document.getElementById("to-balance"),
  approveBtn:   document.getElementById("approve-froll"),
  swapNowBtn:   document.getElementById("swap-now"),
  estGas:       document.getElementById("est-gas"),
  swapMsg:      document.getElementById("swap-msg"),
};

/* ============== HELPERS ============== */
const fmt = (n, d = 4) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (addr = "") => (addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : "");

function setBadge(text, ok = false) {
  els.walletBadge.textContent = text;
  els.walletBadge.style.background = ok ? "#ecfdf5" : "#f3f4f6";
  els.walletBadge.style.color      = ok ? "#065f46" : "#374151";
  els.walletBadge.style.borderColor= ok ? "#a7f3d0" : "#e5e7eb";
}
function setBtnBusy(b) {
  els.connectBtn.disabled = b;
  els.connectBtn.textContent = b ? "Connecting…" : "Connect";
}
function setSwapMsg(text, ok = false) {
  els.swapMsg.textContent = text || "";
  els.swapMsg.style.color = ok ? "#065f46" : "#374151";
}
function parseSafeFloat(v) {
  const x = parseFloat(v);
  return isFinite(x) && x >= 0 ? x : 0;
}

/* ============== READ-ONLY PROVIDER (no wallet) ============== */
function getJsonProvider() {
  if (!jsonProvider) {
    jsonProvider = new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]);
  }
  return jsonProvider;
}

/* ============== WALLET CONNECT / NETWORK ============== */
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

async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) return alert("MetaMask not detected. Please install MetaMask.");

  setBtnBusy(true);
  setBadge("Connecting…");

  try {
    await ensureVictionSelected(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer  = provider.getSigner();
    account = await signer.getAddress();

    // init write-mode contracts
    froll  = new ethers.Contract(FROLL_ADDR,  ERC20_ABI, signer);
    swap   = new ethers.Contract(SWAP_ADDR,   SWAP_ABI,  signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);

    setBadge(`Connected: ${shorten(account)}`, true);
    // enable compose
    els.composeGuard.style.display = "none";
    els.composeArea.style.display  = "block";
    // refresh balances in case swap overlay is open
    await refreshBalances();
  } catch (err) {
    if (err?.code === 4001) {
      setBadge("Connect rejected.");
      alert("Connect failed: please approve requests in MetaMask.");
    } else {
      console.error(err);
      setBadge("Connect failed.");
      alert("Connect failed. Ensure Viction (chainId 88) is selected.");
    }
  } finally {
    setBtnBusy(false);
  }
}

// Simulated "disconnect": clear local state + return to Guest (cannot force MetaMask to forget)
function softDisconnectToHome() {
  els.swapView.style.display = "none";
  els.homeView.style.display = "grid";

  provider = signer = social = swap = froll = undefined;
  account = undefined;

  setBadge("Guest", false);
  els.composeArea.style.display  = "none";
  els.composeGuard.style.display = "block";
}

/* ============== NAV EVENTS ============== */
els.connectBtn.addEventListener("click", async () => {
  await connectWallet();
});

els.openSwapBtn.addEventListener("click", async () => {
  // show overlay first
  els.homeView.style.display = "none";
  els.swapView.style.display = "block";
  // connect if needed
  if (!account) await connectWallet();
  estimateGasSafe().catch(() => {});
});

els.backBtn.addEventListener("click", () => {
  softDisconnectToHome(); // theo yêu cầu: về Home và trở thành Guest
});

/* listen to account/network changes */
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accs) => {
    if (accs && accs.length > 0) {
      account = accs[0];
      setBadge(`Connected: ${shorten(account)}`, true);
      refreshBalances();
    } else {
      softDisconnectToHome();
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

/* ============== FEED (READ-ONLY) ============== */
async function fetchLatestPosts(limit = 20) {
  const prov = getJsonProvider();
  const socialRO = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, prov);

  const next = await socialRO.nextPostId().then(n => Number(n));
  if (!next) return [];

  const start = next;
  const end   = Math.max(1, start - limit + 1);
  const ids   = [];
  for (let i = start; i >= end; i--) ids.push(i);

  const posts = await Promise.all(ids.map(async (id) => {
    try {
      const p = await socialRO.getPost(id);
      // p: { id, author, content, timestamp }
      if (p && p.author !== ethers.constants.AddressZero) return p;
    } catch {}
    return null;
  }));

  return posts.filter(Boolean);
}

async function fetchPostsByAuthor(author) {
  const prov = getJsonProvider();
  const socialRO = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, prov);
  const ids = await socialRO.getUserPosts(author);
  // show newest first, limit 30
  const list = ids.map(n => Number(n)).sort((a,b)=>b-a).slice(0,30);
  const posts = await Promise.all(list.map(async (id) => {
    try { return await socialRO.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}

function renderFeed(posts) {
  els.feedList.innerHTML = "";
  if (!posts || posts.length === 0) {
    els.feedList.innerHTML = `<div class="muted">No posts yet.</div>`;
    return;
  }
  for (const p of posts) {
    const el = document.createElement("div");
    el.className = "post";
    const t = new Date(Number(p.timestamp) * 1000).toLocaleString();
    el.innerHTML = `
      <div class="post-header">${shorten(p.author)} • ${t} • #${p.id}</div>
      <div class="post-content">${escapeHtml(p.content)}</div>
      <div class="post-actions">
        <button class="btn outline tiny" data-tip="${p.id}">Tip</button>
      </div>
    `;
    // Tip click
    el.querySelector("[data-tip]")?.addEventListener("click", () => tipFlow(p.id));
    els.feedList.appendChild(el);
  }
}

function escapeHtml(str="") {
  return str.replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[s])).replace(/\n/g, "<br/>");
}

async function refreshFeed() {
  try {
    els.feedMsg.textContent = "Loading on-chain posts…";
    const author = (els.feedAddr.value || "").trim();
    let posts;
    if (author && /^0x[a-fA-F0-9]{40}$/.test(author)) {
      posts = await fetchPostsByAuthor(author);
    } else {
      posts = await fetchLatestPosts(20);
    }
    renderFeed(posts);
    els.feedMsg.textContent = "Loaded from Social contract. No wallet required.";
  } catch (e) {
    console.error(e);
    els.feedMsg.textContent = "Failed to load posts.";
  }
}

els.btnRefresh.addEventListener("click", refreshFeed);

/* ============== COMPOSE (REGISTER + PUBLISH) ============== */
async function ensureRegistered() {
  if (!social || !account) return false;
  return await social.isRegistered(account);
}

els.btnCreate.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const fee = await social.registerFee();
    // approve fee if needed
    const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    const allow = await erc.allowance(account, SOCIAL_ADDR);
    if (allow.lt(fee)) {
      const tx1 = await erc.approve(SOCIAL_ADDR, fee);
      await tx1.wait();
    }
    const tx = await social.register();
    els.composeMsg.textContent = `Registering… tx: ${tx.hash}`;
    await tx.wait();
    els.composeMsg.textContent = `Registered successfully ✔`;
  } catch (e) {
    console.error(e);
    els.composeMsg.textContent = `Register failed.`;
    alert("Register failed or rejected.");
  }
});

els.btnPublish.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const ok = await ensureRegistered();
    if (!ok) return alert("Please create an account first.");

    const content = (els.txtPost.value || "").trim();
    if (!content) return alert("Enter post content first.");

    // size check
    const prov = getJsonProvider();
    const socialRO = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, prov);
    const maxBytes = await socialRO.MAX_POST_BYTES();
    const enc = new TextEncoder().encode(content);
    if (enc.length > Number(maxBytes)) {
      return alert(`Content too large. Max ${maxBytes} bytes.`);
    }

    const tx = await social.createPost(content);
    els.composeMsg.textContent = `Publishing… tx: ${tx.hash}`;
    await tx.wait();
    els.composeMsg.textContent = `Post published ✔`;
    els.txtPost.value = "";
    refreshFeed();
  } catch (e) {
    console.error(e);
    els.composeMsg.textContent = `Publish failed.`;
    alert("Publish failed or rejected.");
  }
});

/* Tip flow (from feed) */
async function tipFlow(postId) {
  try {
    if (!account) await connectWallet();
    const ok = await ensureRegistered();
    if (!ok) return alert("Please create an account first.");

    const amountStr = prompt("Enter tip amount in FROLL (e.g., 0.01):", "0.01");
    const amount = parseSafeFloat(amountStr);
    if (!amount) return;
    const units = ethers.utils.parseUnits(String(amount), FROLL_DECIMALS);

    const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    const allow = await erc.allowance(account, SOCIAL_ADDR);
    if (allow.lt(units)) {
      const tx1 = await erc.approve(SOCIAL_ADDR, units);
      await tx1.wait();
    }

    const tx = await social.tipPost(postId, units);
    alert(`Tipping… tx: ${tx.hash}`);
    await tx.wait();
    alert("Tip sent ✔");
  } catch (e) {
    console.error(e);
    alert("Tip failed or rejected.");
  }
}

/* ============== SWAP LOGIC (overlay) ============== */
function setDirection(dir) {
  currentDir = dir;
  els.tabs.forEach(b => b.classList.toggle("active", b.dataset.dir === dir));
  if (dir === "VIC2FROLL") {
    els.fromToken.textContent = "VIC";
    els.toToken.textContent   = "FROLL";
    els.approveBtn.style.display = "none";
  } else {
    els.fromToken.textContent = "FROLL";
    els.toToken.textContent   = "VIC";
  }
  els.fromAmt.value = "";
  els.toAmt.value   = "";
  updateOutput();
  refreshBalances();
  estimateGasSafe().catch(()=>{});
}

els.tabs.forEach(b => b.addEventListener("click", () => setDirection(b.dataset.dir)));

function updateOutput() {
  const v = parseSafeFloat(els.fromAmt.value);
  if (!v) return (els.toAmt.value = "");
  if (currentDir === "VIC2FROLL") {
    els.toAmt.value = fmt(v / FIXED_RATE, 6);
  } else {
    els.toAmt.value = fmt(v * FIXED_RATE, 6);
  }
}

els.fromAmt.addEventListener("input", async () => {
  updateOutput();
  if (currentDir === "FROLL2VIC") await maybeToggleApproveBtn();
  estimateGasSafe().catch(()=>{});
});

els.btnMax.addEventListener("click", async () => {
  if (!account || !provider) return;
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
  estimateGasSafe().catch(()=>{});
});

async function refreshBalances() {
  try {
    if (!provider || !account) {
      els.fromBal.textContent = "Balance: –";
      els.toBal.textContent   = "Balance: –";
      return;
    }
    const vicBalWei = await provider.getBalance(account);
    const vicBal    = parseFloat(ethers.utils.formatEther(vicBalWei));
    const frRaw     = await froll.balanceOf(account);
    const frBal     = parseFloat(ethers.utils.formatUnits(frRaw, FROLL_DECIMALS));

    if (currentDir === "VIC2FROLL") {
      els.fromBal.textContent = `Balance: ${fmt(vicBal)} VIC`;
      els.toBal.textContent   = `Balance: ${fmt(frBal, 6)} FROLL`;
    } else {
      els.fromBal.textContent = `Balance: ${fmt(frBal, 6)} FROLL`;
      els.toBal.textContent   = `Balance: ${fmt(vicBal)} VIC`;
    }
  } catch {}
}

async function maybeToggleApproveBtn() {
  try {
    if (!account) return (els.approveBtn.style.display = "none");
    const need = parseSafeFloat(els.fromAmt.value);
    if (!need) return (els.approveBtn.style.display = "none");
    const needUnits = ethers.utils.parseUnits(String(need), FROLL_DECIMALS);
    const allowance = await froll.allowance(account, SWAP_ADDR);
    els.approveBtn.style.display = allowance.lt(needUnits) ? "inline-block" : "none";
  } catch {
    els.approveBtn.style.display = "none";
  }
}

els.approveBtn.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const need = parseSafeFloat(els.fromAmt.value);
    if (!need) return alert("Enter FROLL amount first.");
    const needUnits = ethers.utils.parseUnits(String(need), FROLL_DECIMALS);
    setSwapMsg("Approving FROLL…");
    const tx = await froll.approve(SWAP_ADDR, needUnits);
    await tx.wait();
    setSwapMsg("Approve successful ✔", true);
    await maybeToggleApproveBtn();
  } catch (e) {
    console.error(e);
    setSwapMsg("Approve failed.");
    alert("Approve failed or rejected.");
  }
});

els.swapNowBtn.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const v = parseSafeFloat(els.fromAmt.value);
    if (!v) return alert("Enter amount first.");
    setSwapMsg("Preparing transaction…");

    if (currentDir === "VIC2FROLL") {
      const val = ethers.utils.parseEther(String(v));
      const tx = await swap.swapVicToFroll({ value: val });
      setSwapMsg(`Swapping VIC→FROLL… (tx ${tx.hash.slice(0,10)}…)`);
      await tx.wait();
      setSwapMsg("Swap VIC→FROLL successful ✔", true);
    } else {
      const amt = ethers.utils.parseUnits(String(v), FROLL_DECIMALS);
      const allowance = await froll.allowance(account, SWAP_ADDR);
      if (allowance.lt(amt)) return alert("Please Approve FROLL first.");
      const tx = await swap.swapFrollToVic(amt);
      setSwapMsg(`Swapping FROLL→VIC… (tx ${tx.hash.slice(0,10)}…)`);
      await tx.wait();
      setSwapMsg("Swap FROLL→VIC successful ✔", true);
    }

    els.fromAmt.value = "";
    els.toAmt.value   = "";
    await refreshBalances();
  } catch (e) {
    console.error(e);
    setSwapMsg("Swap failed.");
    alert("Swap failed. Check MetaMask & retry.");
  }
});

async function estimateGasSafe() {
  try {
    if (!swap || !account) { els.estGas.textContent = "Estimated Gas: ~"; return; }
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

/* ============== INIT ============== */
// default: social-first UI
setBadge("Guest", false);
setDirection("VIC2FROLL");

// read feed immediately (no wallet needed)
refreshFeed();

// warm start if MetaMask already selected address
(async function warmStart() {
  if (window.ethereum && window.ethereum.selectedAddress) {
    try { await connectWallet(); } catch {}
  }
})();
