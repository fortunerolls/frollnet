// app.js — Froll.net (Social-first, Swap panel like froll.org) — ethers v5 is loaded via CDN

/* ============== NETWORK & CONTRACTS ============== */
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

// Addresses (VIC)
const FROLL_ADDR  = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // FROLL(18)
const SWAP_ADDR   = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068"; // FROLL<->VIC swap
const SOCIAL_ADDR = "0x28c642682b1E1458d922C4226a7192F5B8953A74"; // FrollSocial

// Decimals
const FROLL_DECIMALS = 18;
const VIC_DECIMALS   = 18;

// NOTE: Hợp đồng swap hiện tại là 2 hàm 1-1. UI KHÔNG hiển thị tỉ lệ cố định, nhưng để tính "toAmount"
// ta dùng tỉ lệ nội bộ 1 FROLL = 100 VIC (giống cách bạn vẫn dùng). Nếu sau này hợp đồng đổi, chỉ cần sửa RATIO.
const RATIO_VIC_PER_FROLL = 100;

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
  "function swapFrollToVic(uint256 frollAmount) returns (bool)"
];

const SOCIAL_ABI = [
  // reads
  "function FROLL() view returns (address)",
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function owner() view returns (address)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function getUserPosts(address) view returns (uint256[] memory)",
  "function getPost(uint256) view returns (tuple(uint256 id, address author, string content, uint64 timestamp))",
  // writes
  "function register()",
  "function createPost(string calldata content) returns (uint256 id)",
  "function tipPost(uint256 postId, uint256 amount)"
];

/* ============== STATE ============== */
let jsonProvider; // read-only provider
let provider, signer, account;
let froll, swap, social;

let swapDirection = "VIC2FROLL"; // or "FROLL2VIC"

/* ============== DOM ============== */
// Navbar
const elConnectBtn   = document.getElementById("connect-wallet");
const elSwapOpen     = document.getElementById("btn-open-swap");
const elBadge        = document.getElementById("wallet-badge");

// Views
const elHomeView     = document.getElementById("home-view");
const elSwapPanel    = document.getElementById("swap-interface");
const elBackHome     = document.getElementById("btn-back-to-home");
const elDisconnect   = document.getElementById("disconnect-wallet");
const elWalletAddr   = document.getElementById("wallet-address");

// Composer
const elGuard        = document.getElementById("compose-guard");
const elCompose      = document.getElementById("compose-area");
const elRegister     = document.getElementById("register-account");
const elPostContent  = document.getElementById("post-content");
const elPublish      = document.getElementById("btn-publish");
const elComposeMsg   = document.getElementById("compose-msg");

// Feed
const elFeedList     = document.getElementById("feed-list");
const elFeedMsg      = document.getElementById("feed-msg");
const elFilterAddr   = document.getElementById("feed-address");
const elRefreshFeed  = document.getElementById("btn-refresh");

// Swap elements (ported structure)
const elFromLogo     = document.getElementById("from-token-logo");
const elToLogo       = document.getElementById("to-token-logo");
const elFromInfo     = document.getElementById("from-token-info");
const elToInfo       = document.getElementById("to-token-info");
const elFromAmount   = document.getElementById("from-amount");
const elToAmount     = document.getElementById("to-amount");
const elMaxButton    = document.getElementById("max-button");
const elSwapDir      = document.getElementById("swap-direction");
const elSwapNow      = document.getElementById("swap-now");
const elTxFee        = document.getElementById("transaction-fee");
const elGasFee       = document.getElementById("gas-fee");

/* ============== HELPERS ============== */
const fmt = (n, d = 6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (a="") => a ? `${a.slice(0,6)}…${a.slice(-4)}` : "";

function setBadge(text, ok=false) {
  elBadge.textContent = text;
  elBadge.style.background = ok ? "#ecfdf5" : "#f3f4f6";
  elBadge.style.color      = ok ? "#065f46" : "#374151";
  elBadge.style.borderColor= ok ? "#a7f3d0" : "#e5e7eb";
}

function getJsonProvider() {
  if (!jsonProvider) jsonProvider = new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]);
  return jsonProvider;
}

async function ensureViction(eth) {
  const cid = await eth.request({ method: "eth_chainId" });
  if (cid?.toLowerCase() === VIC_CHAIN.chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN.chainId }] });
  } catch (e) {
    if (e?.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_CHAIN] });
    } else {
      throw e;
    }
  }
}

/* ============== CONNECT / DISCONNECT ============== */
async function connectWallet() {
  const eth = window.ethereum;
  if (!eth) return alert("MetaMask not detected. Please install MetaMask.");
  elConnectBtn.disabled = true; elConnectBtn.textContent = "Connecting…"; setBadge("Connecting…");

  try {
    await ensureViction(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer  = provider.getSigner();
    account = await signer.getAddress();

    // contracts write-mode
    froll  = new ethers.Contract(FROLL_ADDR,  ERC20_ABI,  signer);
    swap   = new ethers.Contract(SWAP_ADDR,   SWAP_ABI,   signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);

    setBadge(`Connected: ${shorten(account)}`, true);
    elGuard.style.display   = "none";
    elCompose.style.display = "block";
    elWalletAddr.textContent = shorten(account);

    // Ẩn nút Register nếu đã đăng ký
    try {
      const reg = await social.isRegistered(account);
      elRegister.style.display = reg ? "none" : "inline-block";
    } catch { /* ignore */ }

    // Nếu đang ở panel Swap: cập nhật số dư hiển thị
    if (elSwapPanel.style.display !== "none") {
      await refreshSwapBalances();
    }
  } catch (e) {
    console.error(e);
    alert("Connect failed or rejected.");
    setBadge("Guest");
  } finally {
    elConnectBtn.disabled = false; elConnectBtn.textContent = "Connect";
  }
}

function softDisconnect(toHome=true) {
  provider = signer = froll = swap = social = undefined;
  account = undefined;
  setBadge("Guest");
  elCompose.style.display = "none";
  elGuard.style.display   = "block";
  elWalletAddr.textContent = "—";
  if (toHome) {
    elSwapPanel.style.display = "none";
    elHomeView.style.display  = "grid";
  }
}

/* listen metamask changes */
if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accs) => {
    if (accs && accs.length > 0) {
      account = accs[0];
      setBadge(`Connected: ${shorten(account)}`, true);
      elWalletAddr.textContent = shorten(account);
      // Re-wire signer & contracts
      if (provider) signer = provider.getSigner();
      if (signer) {
        froll  = new ethers.Contract(FROLL_ADDR,  ERC20_ABI,  signer);
        swap   = new ethers.Contract(SWAP_ADDR,   SWAP_ABI,   signer);
        social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);
      }
      // Update UI bits
      elCompose.style.display = "block";
      elGuard.style.display   = "none";
      checkRegistered().catch(()=>{});
      refreshSwapBalances().catch(()=>{});
    } else {
      softDisconnect(false);
    }
  });
  window.ethereum.on?.("chainChanged", (cid) => {
    if (cid?.toLowerCase() !== VIC_CHAIN.chainId) {
      setBadge("Wrong network. Switching…");
      ensureViction(window.ethereum).catch(()=> setBadge("Please switch to Viction (88)"));
    }
  });
}

/* ============== SOCIAL — READ FEED (no wallet) ============== */
async function fetchLatestPosts(limit = 20) {
  const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getJsonProvider());
  const next = await ro.nextPostId().then(n => Number(n)).catch(()=>0);
  if (!next) return [];
  const start = next;
  const end = Math.max(1, start - limit + 1);
  const ids = [];
  for (let i = start; i >= end; i--) ids.push(i);
  const posts = await Promise.all(ids.map(async (id) => {
    try { return await ro.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}

async function fetchPostsByAuthor(author) {
  const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getJsonProvider());
  const ids = await ro.getUserPosts(author).catch(()=>[]);
  const list = ids.map(n=>Number(n)).sort((a,b)=>b-a).slice(0,30);
  const posts = await Promise.all(list.map(async (id) => {
    try { return await ro.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}

function renderFeed(posts) {
  elFeedList.innerHTML = "";
  if (!posts || posts.length === 0) {
    elFeedList.innerHTML = `<div class="muted">No posts yet.</div>`;
    return;
  }
  for (const p of posts) {
    const wrap = document.createElement("div");
    wrap.className = "post";

    const t = new Date(Number(p.timestamp) * 1000).toLocaleString();
    const header = document.createElement("div");
    header.className = "post-header";
    header.textContent = `${shorten(p.author)} • ${t} • #${p.id}`;

    const contentEl = document.createElement("div");
    contentEl.className = "post-content";
    // Giữ định dạng: dùng textContent + CSS white-space: pre-wrap
    contentEl.textContent = p.content || "";

    wrap.appendChild(header);
    wrap.appendChild(contentEl);
    elFeedList.appendChild(wrap);
  }
}

async function refreshFeed() {
  try {
    elFeedMsg.textContent = "Loading on-chain posts…";
    const flt = (elFilterAddr.value || "").trim();
    let posts;
    if (flt && /^0x[a-fA-F0-9]{40}$/.test(flt)) posts = await fetchPostsByAuthor(flt);
    else posts = await fetchLatestPosts(20);
    renderFeed(posts);
    elFeedMsg.textContent = "Loaded from Social contract. No wallet required.";
  } catch (e) {
    console.error(e);
    elFeedMsg.textContent = "Failed to load posts.";
  }
}

/* ============== SOCIAL — WRITE (needs wallet) ============== */
async function checkRegistered() {
  if (!social || !account) return;
  const reg = await social.isRegistered(account).catch(()=>false);
  elRegister.style.display = reg ? "none" : "inline-block";
}

elRegister.addEventListener("click", async () => {
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
    elComposeMsg.textContent = `Registering… tx: ${tx.hash}`;
    await tx.wait();
    elComposeMsg.textContent = `Registered successfully ✔`;
    elRegister.style.display = "none";
  } catch (e) {
    console.error(e);
    elComposeMsg.textContent = `Register failed.`;
    alert("Register failed or rejected.");
  }
});

elPublish.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();

    const reg = await social.isRegistered(account);
    if (!reg) return alert("Please register your account first (0.001 FROLL).");

    const content = (elPostContent.value || "").trim();
    if (!content) return alert("Enter post content first.");

    const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getJsonProvider());
    const maxBytes = await ro.MAX_POST_BYTES();
    const enc = new TextEncoder().encode(content);
    if (enc.length > Number(maxBytes)) {
      return alert(`Content too large. Max ${maxBytes} bytes.`);
    }

    const tx = await social.createPost(content);
    elComposeMsg.textContent = `Publishing… tx: ${tx.hash}`;
    await tx.wait();
    elComposeMsg.textContent = `Post published ✔`;
    elPostContent.value = "";
    refreshFeed();
  } catch (e) {
    console.error(e);
    elComposeMsg.textContent = `Publish failed.`;
    alert("Publish failed or rejected.");
  }
});

/* ============== SWAP PANEL (like froll.org) ============== */
// Show/hide
elSwapOpen.addEventListener("click", async () => {
  elHomeView.style.display = "none";
  elSwapPanel.style.display = "block";
  if (!account) await connectWallet();
  await refreshSwapBalances();
});
elBackHome.addEventListener("click", () => softDisconnect(true));
elDisconnect.addEventListener("click", () => softDisconnect(true));

function setSwapDirection(dir) {
  swapDirection = dir;
  // Logos & labels
  if (swapDirection === "VIC2FROLL") {
    elFromLogo.src = "vic_24.png";
    elToLogo.src   = "froll_24.png";
  } else {
    elFromLogo.src = "froll_24.png";
    elToLogo.src   = "vic_24.png";
  }
  elFromAmount.value = "";
  elToAmount.value   = "";
  refreshSwapBalances();
}

elSwapDir.addEventListener("click", () => {
  setSwapDirection(swapDirection === "VIC2FROLL" ? "FROLL2VIC" : "VIC2FROLL");
});

async function refreshSwapBalances() {
  try {
    if (!account || !provider) {
      elFromInfo.textContent = swapDirection === "VIC2FROLL" ? "VIC: —" : "FROLL: —";
      elToInfo.textContent   = swapDirection === "VIC2FROLL" ? "FROLL: —" : "VIC: —";
      return;
    }
    const vicWei  = await provider.getBalance(account);
    const frollWei= await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);

    const vic  = parseFloat(ethers.utils.formatEther(vicWei));
    const fr   = parseFloat(ethers.utils.formatUnits(frollWei, FROLL_DECIMALS));

    if (swapDirection === "VIC2FROLL") {
      elFromInfo.textContent = `VIC: ${fmt(vic, 6)}`;
      elToInfo.textContent   = `FROLL: ${fmt(fr, 6)}`;
    } else {
      elFromInfo.textContent = `FROLL: ${fmt(fr, 6)}`;
      elToInfo.textContent   = `VIC: ${fmt(vic, 6)}`;
    }
  } catch {}
}

function updateToAmountPreview() {
  const v = parseFloat(elFromAmount.value || "0");
  if (!isFinite(v) || v <= 0) { elToAmount.value = ""; return; }
  // UI tự tính, không in ra tỉ lệ; dùng ratio nội bộ hiện tại
  if (swapDirection === "VIC2FROLL") {
    elToAmount.value = fmt(v / RATIO_VIC_PER_FROLL, 6);
  } else {
    elToAmount.value = fmt(v * RATIO_VIC_PER_FROLL, 6);
  }
}

elFromAmount.addEventListener("input", updateToAmountPreview);

elMaxButton.addEventListener("click", async () => {
  if (!account || !provider) return;
  if (swapDirection === "VIC2FROLL") {
    const vicWei = await provider.getBalance(account);
    let vic = parseFloat(ethers.utils.formatEther(vicWei));
    vic = Math.max(0, vic - 0.02); // chừa ~0.02 VIC cho gas + fee 0.01
    elFromAmount.value = vic > 0 ? vic.toFixed(6) : "";
  } else {
    const balRaw = await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);
    const fr = parseFloat(ethers.utils.formatUnits(balRaw, FROLL_DECIMALS));
    elFromAmount.value = fr > 0 ? fr.toFixed(6) : "";
  }
  updateToAmountPreview();
  refreshSwapBalances();
});

elSwapNow.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const amt = parseFloat(elFromAmount.value || "0");
    if (!isFinite(amt) || amt <= 0) return alert("Enter amount first.");
    if (!swap) swap = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);

    if (swapDirection === "VIC2FROLL") {
      const value = ethers.utils.parseEther(String(amt));
      const tx = await swap.swapVicToFroll({ value });
      elGasFee.textContent = "Submitting…";
      await tx.wait();
      elGasFee.textContent = "Done ✔";
    } else {
      const frollAmt = ethers.utils.parseUnits(String(amt), FROLL_DECIMALS);
      const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
      const allow = await erc.allowance(account, SWAP_ADDR);
      if (allow.lt(frollAmt)) {
        const tx1 = await erc.approve(SWAP_ADDR, frollAmt);
        await tx1.wait();
      }
      const tx = await swap.swapFrollToVic(frollAmt);
      elGasFee.textContent = "Submitting…";
      await tx.wait();
      elGasFee.textContent = "Done ✔";
    }
    elFromAmount.value = ""; elToAmount.value = "";
    await refreshSwapBalances();
  } catch (e) {
    console.error(e);
    alert("Swap failed or rejected.");
  }
});

/* ============== NAV EVENTS ============== */
elConnectBtn.addEventListener("click", connectWallet);

/* ============== INIT ============== */
setBadge("Guest");
setSwapDirection("VIC2FROLL");
refreshFeed();

// Warm start if MetaMask already selected
(async function warmStart(){
  if (window.ethereum && window.ethereum.selectedAddress) {
    try { await connectWallet(); } catch {}
  }
})();
