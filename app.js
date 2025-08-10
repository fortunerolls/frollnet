// app.js — Froll.net (VinSocial style + clean Swap overlay) — ethers v5 is loaded via CDN

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

const FROLL_ADDR  = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // FROLL(18)
const SWAP_ADDR   = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068"; // Swap VIC↔FROLL
const SOCIAL_ADDR = "0x28c642682b1E1458d922C4226a7192F5B8953A74"; // FrollSocial

const FROLL_DECIMALS = 18;
const RATIO_VIC_PER_FROLL = 100; // dùng nội bộ để tính ô "to amount"

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
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function getUserPosts(address) view returns (uint256[] memory)",
  "function getPost(uint256) view returns (tuple(uint256 id, address author, string content, uint64 timestamp))",
  "function register()",
  "function createPost(string calldata content) returns (uint256 id)"
];

/* ============== STATE ============== */
let roProvider; // read-only provider
let provider, signer, account;
let froll, swap, social;
let swapDirection = "VIC2FROLL";

/* ============== DOM ============== */
// Brand bar
const elPriceChip   = document.getElementById("froll-price-usd");
const elBadgeFroll  = document.getElementById("badge-froll");
const elBadgeVic    = document.getElementById("badge-vic");
const elStatus      = document.getElementById("wallet-status");
const elConnectBtn  = document.getElementById("connect-wallet");
const elGuide       = document.getElementById("guide-link");

// Trade bar
const elOpenSwap    = document.getElementById("btn-open-swap");

// Home / feed
const elHomeView    = document.getElementById("home-view");
const elComposer    = document.getElementById("composer");
const elRegister    = document.getElementById("register-account");
const elPostContent = document.getElementById("post-content");
const elPostMedia   = document.getElementById("post-media");
const elPublish     = document.getElementById("btn-publish");
const elComposeMsg  = document.getElementById("compose-msg");
const elFeedList    = document.getElementById("feed-list");
const elFeedMsg     = document.getElementById("feed-msg");
const elFeedAddr    = document.getElementById("feed-address");
const elRefresh     = document.getElementById("btn-refresh");

// Swap view
const elSwapView    = document.getElementById("swap-view");
const elBackHome    = document.getElementById("btn-back-home");
const elBtnDisco    = document.getElementById("btn-disconnect");
const elFromLogo    = document.getElementById("from-token-logo");
const elToLogo      = document.getElementById("to-token-logo");
const elFromInfo    = document.getElementById("from-token-info");
const elToInfo      = document.getElementById("to-token-info");
const elFromAmount  = document.getElementById("from-amount");
const elToAmount    = document.getElementById("to-amount");
const elMaxBtn      = document.getElementById("max-button");
const elSwapDir     = document.getElementById("swap-direction");
const elSwapNow     = document.getElementById("swap-now");
const elTxFee       = document.getElementById("transaction-fee");
const elGasFee      = document.getElementById("gas-fee");

/* ============== HELPERS ============== */
const fmt = (n, d = 6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (a="") => a ? `${a.slice(0,6)}…${a.slice(-4)}` : "";
const getRO = () => (roProvider ||= new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]));

async function ensureViction(eth) {
  const cid = await eth.request({ method: "eth_chainId" });
  if (cid?.toLowerCase() === VIC_CHAIN.chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN.chainId }] });
  } catch (e) {
    if (e?.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_CHAIN] });
    } else { throw e; }
  }
}

function setGuestUI() {
  elStatus.textContent = "Not connected";
  elConnectBtn.textContent = "Connect Wallet";
  elBadgeVic.style.display = "none";
  elBadgeFroll.style.display = "none";
  elComposer.style.display = "none";
}

function setConnectedUI() {
  elStatus.textContent = shorten(account);
  elConnectBtn.textContent = "Disconnect";
  elComposer.style.display = "grid";
}

async function connectWallet() {
  if (account) { // toggle = disconnect
    softDisconnect();
    return;
  }
  const eth = window.ethereum;
  if (!eth) return alert("MetaMask not detected. Please install MetaMask.");
  elConnectBtn.disabled = true; elConnectBtn.textContent = "Connecting…"; elStatus.textContent = "Connecting…";

  try {
    await ensureViction(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer  = provider.getSigner();
    account = await signer.getAddress();

    froll  = new ethers.Contract(FROLL_ADDR,  ERC20_ABI,  signer);
    swap   = new ethers.Contract(SWAP_ADDR,   SWAP_ABI,   signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);

    setConnectedUI();
    await Promise.all([refreshBalances(), checkRegistered()]);
    if (document.body.classList.contains("swap-open")) {
      await refreshSwapBalances();
    }
  } catch (e) {
    console.error(e);
    alert("Connect failed or rejected.");
    setGuestUI();
  } finally {
    elConnectBtn.disabled = false;
  }
}

function softDisconnect() {
  provider = signer = froll = swap = social = undefined;
  account = undefined;
  setGuestUI();
  // Thoát swap nếu đang mở
  if (document.body.classList.contains("swap-open")) {
    closeSwap();
  }
}

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", (accs) => {
    if (accs && accs.length > 0) {
      account = accs[0];
      if (provider) signer = provider.getSigner();
      if (signer) {
        froll  = new ethers.Contract(FROLL_ADDR,  ERC20_ABI,  signer);
        swap   = new ethers.Contract(SWAP_ADDR,   SWAP_ABI,   signer);
        social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);
      }
      setConnectedUI();
      refreshBalances().catch(()=>{});
      checkRegistered().catch(()=>{});
      refreshSwapBalances().catch(()=>{});
    } else {
      softDisconnect();
    }
  });
  window.ethereum.on?.("chainChanged", (cid) => {
    if (cid?.toLowerCase() !== VIC_CHAIN.chainId) {
      elStatus.textContent = "Wrong network";
    } else if (account) {
      elStatus.textContent = shorten(account);
    }
  });
}

/* ============== FEED (READ-ONLY) ============== */
async function fetchLatestPosts(limit = 20) {
  const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getRO());
  const next = await ro.nextPostId().then(n => Number(n)).catch(()=>0);
  if (!next) return [];
  const start = next, end = Math.max(1, start - limit + 1);
  const ids = []; for (let i = start; i >= end; i--) ids.push(i);
  const posts = await Promise.all(ids.map(async id => {
    try { return await ro.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}
async function fetchPostsByAuthor(addr) {
  const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getRO());
  const ids = await ro.getUserPosts(addr).catch(()=>[]);
  const list = ids.map(n=>Number(n)).sort((a,b)=>b-a).slice(0,30);
  const posts = await Promise.all(list.map(async id => {
    try { return await ro.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}

function detectMediaUrl(text="") {
  // Tìm URL http/https; ưu tiên ảnh/video phổ biến
  const urlRegex = /(https?:\/\/[^\s)]+)$/im; // lấy URL ở cuối dòng/nội dung
  const m = text.match(urlRegex);
  if (!m) return null;
  const u = m[1];
  const isImg = /\.(png|jpe?g|gif|webp)$/i.test(u);
  const isVid = /\.(mp4|webm|ogg)$/i.test(u);
  return { url: u, isImg, isVid };
}

function renderFeed(posts) {
  elFeedList.innerHTML = "";
  if (!posts || posts.length === 0) {
    elFeedList.innerHTML = `<div class="meta meta-center">No posts yet.</div>`;
    return;
  }
  for (const p of posts) {
    const card = document.createElement("article");
    card.className = "post";

    const t = new Date(Number(p.timestamp) * 1000).toLocaleString();
    const head = document.createElement("div");
    head.className = "post-header";
    head.textContent = `${shorten(p.author)} • ${t} • #${p.id}`;

    const content = document.createElement("div");
    content.className = "post-content";
    // giữ định dạng (pre-wrap) → dùng textContent
    const text = p.content || "";
    content.textContent = text;

    const media = detectMediaUrl(text);
    let mediaEl = null;
    if (media?.isImg) {
      mediaEl = document.createElement("div");
      mediaEl.className = "post-media";
      mediaEl.innerHTML = `<img src="${media.url}" alt="media"/>`;
    } else if (media?.isVid) {
      mediaEl = document.createElement("div");
      mediaEl.className = "post-media";
      mediaEl.innerHTML = `<video src="${media.url}" controls></video>`;
    }

    card.appendChild(head);
    card.appendChild(content);
    if (mediaEl) card.appendChild(mediaEl);
    elFeedList.appendChild(card);
  }
}

async function refreshFeed() {
  try {
    elFeedMsg.textContent = "Loading on-chain posts…";
    const q = (elFeedAddr.value || "").trim();
    let posts;
    if (q && /^0x[a-fA-F0-9]{40}$/.test(q)) posts = await fetchPostsByAuthor(q);
    else posts = await fetchLatestPosts(20);
    renderFeed(posts);
    elFeedMsg.textContent = "Loaded from Social contract. No wallet required.";
  } catch (e) {
    console.error(e);
    elFeedMsg.textContent = "Failed to load posts.";
  }
}
elRefresh.addEventListener("click", refreshFeed);

/* ============== SOCIAL WRITE ============== */
async function checkRegistered() {
  if (!social || !account) return;
  const reg = await social.isRegistered(account).catch(()=>false);
  elRegister.style.display = reg ? "none" : "inline-block";
}
async function refreshBalances() {
  try {
    if (!provider || !account) return;
    const vicWei = await provider.getBalance(account);
    const frWei  = await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);
    const vic = parseFloat(ethers.utils.formatEther(vicWei));
    const fr  = parseFloat(ethers.utils.formatUnits(frWei, FROLL_DECIMALS));
    elBadgeVic.textContent = `${fmt(vic, 6)} VIC`;
    elBadgeFroll.textContent = `${fmt(fr, 6)} FROLL`;
    elBadgeVic.style.display = "inline-block";
    elBadgeFroll.style.display = "inline-block";
  } catch {}
}

elRegister.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const fee = await social.registerFee();
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
    await refreshBalances();
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
    const media   = (elPostMedia.value || "").trim();
    if (!content && !media) return alert("Please write something or add a media URL.");

    // Gộp media URL vào cuối content để lưu on-chain
    const full = media ? `${content}\n\n${media}` : content;

    // Size check
    const maxBytes = await new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getRO()).MAX_POST_BYTES();
    const enc = new TextEncoder().encode(full);
    if (enc.length > Number(maxBytes)) {
      return alert(`Content too large. Max ${maxBytes} bytes.`);
    }

    const tx = await social.createPost(full);
    elComposeMsg.textContent = `Publishing… tx: ${tx.hash}`;
    await tx.wait();
    elComposeMsg.textContent = `Post published ✔`;
    elPostContent.value = ""; elPostMedia.value = "";
    refreshFeed();
  } catch (e) {
    console.error(e);
    elComposeMsg.textContent = `Publish failed.`;
    alert("Publish failed or rejected.");
  }
});

/* ============== SWAP (overlay) ============== */
function openSwap() {
  document.body.classList.add("swap-open");
  elSwapView.style.display = "block";
  if (!account) connectWallet().then(()=>refreshSwapBalances());
  else refreshSwapBalances();
}
function closeSwap() {
  document.body.classList.remove("swap-open");
  elSwapView.style.display = "none";
}

elOpenSwap.addEventListener("click", openSwap);
elBackHome.addEventListener("click", closeSwap);
elBtnDisco.addEventListener("click", () => { softDisconnect(); closeSwap(); });

function setSwapDirection(dir) {
  swapDirection = dir;
  if (dir === "VIC2FROLL") {
    elFromLogo.src = "vic_24.png";
    elToLogo.src   = "froll_24.png";
  } else {
    elFromLogo.src = "froll_24.png";
    elToLogo.src   = "vic_24.png";
  }
  elFromAmount.value = "";
  elToAmount.value   = "";
  refreshSwapBalances().catch(()=>{});
}
elSwapDir.addEventListener("click", () =>
  setSwapDirection(swapDirection === "VIC2FROLL" ? "FROLL2VIC" : "VIC2FROLL")
);

function updatePreview() {
  const v = parseFloat(elFromAmount.value || "0");
  if (!isFinite(v) || v <= 0) { elToAmount.value = ""; return; }
  elToAmount.value =
    swapDirection === "VIC2FROLL" ? fmt(v / RATIO_VIC_PER_FROLL, 6) : fmt(v * RATIO_VIC_PER_FROLL, 6);
}
elFromAmount.addEventListener("input", updatePreview);

elMaxBtn.addEventListener("click", async () => {
  if (!account || !provider) return;
  if (swapDirection === "VIC2FROLL") {
    const vicWei = await provider.getBalance(account);
    let vic = parseFloat(ethers.utils.formatEther(vicWei));
    vic = Math.max(0, vic - 0.02); // chừa ~0.02 VIC cho gas + fee
    elFromAmount.value = vic > 0 ? vic.toFixed(6) : "";
  } else {
    const balRaw = await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);
    const fr = parseFloat(ethers.utils.formatUnits(balRaw, FROLL_DECIMALS));
    elFromAmount.value = fr > 0 ? fr.toFixed(6) : "";
  }
  updatePreview();
  refreshSwapBalances();
});

async function refreshSwapBalances() {
  try {
    if (!provider || !account) {
      elFromInfo.textContent = swapDirection === "VIC2FROLL" ? "VIC: —" : "FROLL: —";
      elToInfo.textContent   = swapDirection === "VIC2FROLL" ? "FROLL: —" : "VIC: —";
      return;
    }
    const vicWei = await provider.getBalance(account);
    const frWei  = await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);
    const vic = parseFloat(ethers.utils.formatEther(vicWei));
    const fr  = parseFloat(ethers.utils.formatUnits(frWei, FROLL_DECIMALS));

    if (swapDirection === "VIC2FROLL") {
      elFromInfo.textContent = `VIC: ${fmt(vic, 6)}`;
      elToInfo.textContent   = `FROLL: ${fmt(fr, 6)}`;
    } else {
      elFromInfo.textContent = `FROLL: ${fmt(fr, 6)}`;
      elToInfo.textContent   = `VIC: ${fmt(vic, 6)}`;
    }
  } catch {}
}

elSwapNow.addEventListener("click", async () => {
  try {
    if (!account) await connectWallet();
    const amt = parseFloat(elFromAmount.value || "0");
    if (!isFinite(amt) || amt <= 0) return alert("Enter amount first.");
    if (!swap) swap = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);

    if (swapDirection === "VIC2FROLL") {
      const value = ethers.utils.parseEther(String(amt));
      elGasFee.textContent = "Submitting…";
      const tx = await swap.swapVicToFroll({ value });
      await tx.wait();
      elGasFee.textContent = "Done ✔";
    } else {
      const units = ethers.utils.parseUnits(String(amt), FROLL_DECIMALS);
      const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
      const allow = await erc.allowance(account, SWAP_ADDR);
      if (allow.lt(units)) {
        const tx1 = await erc.approve(SWAP_ADDR, units);
        elGasFee.textContent = "Approving…";
        await tx1.wait();
      }
      elGasFee.textContent = "Submitting…";
      const tx = await swap.swapFrollToVic(units);
      await tx.wait();
      elGasFee.textContent = "Done ✔";
    }
    elFromAmount.value = ""; elToAmount.value = "";
    await Promise.all([refreshSwapBalances(), refreshBalances()]);
  } catch (e) {
    console.error(e);
    elGasFee.textContent = "Error";
    alert("Swap failed or rejected.");
  }
});

/* ============== NAV EVENTS ============== */
elConnectBtn.addEventListener("click", connectWallet);

/* ============== INIT ============== */
setGuestUI();
setSwapDirection("VIC2FROLL");
refreshFeed();
