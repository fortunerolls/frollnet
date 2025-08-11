// app.js — Froll.net (VinSocial-style Social + Swap overlay)

/* NETWORK & CONTRACTS */
const VIC_CHAIN = {
  chainId: "0x58",
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: ["https://rpc.viction.xyz", "https://viction.blockpi.network/v1/rpc/public"],
  blockExplorerUrls: ["https://vicscan.xyz"]
};
const FROLL_ADDR  = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const SWAP_ADDR   = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068";
const SOCIAL_ADDR = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82";
const FROLL_DECIMALS = 18;
const RATIO_VIC_PER_FROLL = 100;

/* ABIs */
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];
const SWAP_ABI = [
  "function swapVicToFroll() payable",
  "function swapFrollToVic(uint256 frollAmount) returns (bool)"
];
const SOCIAL_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "frollToken",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "content",
        "type": "string"
      }
    ],
    "name": "createPost",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "postId",
        "type": "uint256"
      }
    ],
    "name": "likePost",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "postId",
        "type": "uint256"
      }
    ],
    "name": "followPost",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isRegistered",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextPostId",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

/* STATE */
let roProvider, provider, signer, account, froll, swap, social;
let isRegistered = false;
let swapDirection = "VIC2FROLL";

/* DOM */
const $ = (id) => document.getElementById(id);
// brand / wallet
const elBadgeFroll = $("badge-froll"),
  elBadgeVic = $("badge-vic"),
  elStatus = $("wallet-status"),
  elConnectBtn = $("connect-wallet");
// quick nav
const elQHome = $("qn-home"),
  elQProfile = $("qn-profile"),
  elQNew = $("qn-newpost"),
  elFeedAddr = $("feed-address"),
  elBtnSearch = $("btn-search");
// composer
const elComposer = $("composer"),
  elRegister = $("register-account"),
  elPostContent = $("post-content"),
  elPostMedia = $("post-media"),
  elPublish = $("btn-publish"),
  elComposeMsg = $("compose-msg");
// feed
const elFeedList = $("feed-list"),
  elFeedMsg = $("feed-msg");
// swap
const elOpenSwap = $("btn-open-swap"),
  elSwapView = $("swap-view"),
  elBackHome = $("btn-back-home"),
  elBtnDisco = $("btn-disconnect");
const elFromLogo = $("from-token-logo"),
  elToLogo = $("to-token-logo"),
  elFromInfo = $("from-token-info"),
  elToInfo = $("to-token-info");
const elFromAmount = $("from-amount"),
  elToAmount = $("to-amount"),
  elMaxBtn = $("max-button"),
  elSwapDir = $("swap-direction"),
  elSwapNow = $("swap-now"),
  elGasFee = $("gas-fee");

/* HELPERS */
const fmt = (n, d = 6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (a = "") => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const getRO = () => (roProvider ||= new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]));

async function ensureViction(eth) {
  const cid = await eth.request({ method: "eth_chainId" });
  if (cid?.toLowerCase() === VIC_CHAIN.chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN.chainId }] });
  } catch (e) {
    if (e?.code === 4902) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_CHAIN] });
    } else throw e;
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

/* CONNECT / DISCONNECT */
async function connectWallet() {
  if (account) { softDisconnect(); return; } // toggle = disconnect
  const eth = window.ethereum; if (!eth) return alert("MetaMask not detected.");
  elConnectBtn.disabled = true;
  elConnectBtn.textContent = "Connecting…";
  elStatus.textContent = "Connecting…";
  try {
    await ensureViction(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    account = await signer.getAddress();
    froll = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    swap = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);
    setConnectedUI();
    await Promise.all([refreshBalances()]);
    await checkRegistered(); // ⬅️ đảm bảo cập nhật biến isRegistered
    await refreshFeed(); // ⬅️ re-render feed để hiện nút 👍💬🔁
    if (document.body.classList.contains("swap-open")) await refreshSwapBalances();
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
  isRegistered = false;
  setGuestUI();
  refreshFeed(); // ⬅️ render lại để ẩn nút hành động
  if (document.body.classList.contains("swap-open")) closeSwap();
}

if (window.ethereum) {
  window.ethereum.on?.("accountsChanged", async (accs) => {
    if (accs && accs.length) {
      account = accs[0];
      if (provider) signer = provider.getSigner();
      if (signer) {
        froll = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
        swap = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);
        social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);
      }
      setConnectedUI();
      await refreshBalances();
      await checkRegistered(); // ⬅️ cập nhật cờ và
      await refreshFeed(); // ⬅️ vẽ lại feed
      refreshSwapBalances().catch(() => { });
    } else { softDisconnect(); }
  });
  window.ethereum.on?.("chainChanged", (cid) => {
    if (cid?.toLowerCase() !== VIC_CHAIN.chainId) elStatus.textContent = "Wrong network";
    else if (account) elStatus.textContent = shorten(account);
  });
}

/* Balances & Register */
async function refreshBalances() {
  try {
    if (!provider || !account) return;
    const vicWei = await provider.getBalance(account);
    const frWei = await new ethers.Contract(FROLL_ADDR, ERC20_ABI, provider).balanceOf(account);
    elBadgeVic.textContent = `${fmt(parseFloat(ethers.utils.formatEther(vicWei)), 6)} VIC`;
    elBadgeFroll.textContent = `${fmt(parseFloat(ethers.utils.formatUnits(frWei, FROLL_DECIMALS)), 6)} FROLL`;
    elBadgeVic.style.display = "inline-block";
    elBadgeFroll.style.display = "inline-block";
  } catch { }
}

async function checkRegistered() {
  if (!social || !account) { isRegistered = false; elRegister.style.display = "inline-block"; return false; }
  isRegistered = await social.isRegistered(account).catch(() => false);
  elRegister.style.display = isRegistered ? "none" : "inline-block";
  return isRegistered;
}

/* FEED (READ-ONLY) */
async function fetchLatestPosts(limit = 20) {
  const ro = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getRO());
  const ids = await latestIds(limit);
  const posts = await Promise.all(ids.map(async id => {
    try { return await ro.getPost(id); } catch { return null; }
  }));
  return posts.filter(Boolean);
}

async function renderFeed(posts) {
  elFeedList.innerHTML = "";
  if (!posts || !posts.length) { elFeedList.innerHTML = `<div class="meta meta-center">No posts yet.</div>`; return; }
  for (const p of posts) {
    const t = new Date(Number(p.timestamp) * 1000).toLocaleString();
    const card = document.createElement("article");
    card.className = "post";
    card.id = `post-${p.id}`;
    const head = document.createElement("div");
    head.className = "post-header";
    head.textContent = `${shorten(p.author)} • ${t} • #${p.id}`;
    const content = document.createElement("div");
    content.className = "post-content";
    const text = p.content || "";
    content.textContent = text;
    const media = detectMediaUrl(text);
    if (media) {
      const m = document.createElement("div");
      m.className = "post-media";
      m.innerHTML = media.isImg ? `<img src="${media.url}" alt="media"/>` : (media.isVid ? `<video src="${media.url}" controls></video>` : "");
      if (m.innerHTML) card.appendChild(m);
    }
    // Actions (giống VinSocial: Profile/Translate luôn hiển thị, thêm Like/Comment/Share khi đã đăng ký)
    const act = document.createElement("div");
    act.className = "post-actions";
    const btnProfile = document.createElement("button");
    btnProfile.className = "action-btn";
    btnProfile.textContent = "👤 Profile";
    btnProfile.addEventListener("click", () => { elFeedAddr.value = p.author; refreshFeed(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    const btnTrans = document.createElement("button");
    btnTrans.className = "action-btn";
    btnTrans.textContent = "🌐 Translate";
    btnTrans.addEventListener("click", () => { const url = `https://translate.google.com/?sl=auto&tl=vi&text=${encodeURIComponent(text)}&op=translate`; window.open(url, "_blank"); });
    act.appendChild(btnProfile); act.appendChild(btnTrans);
    if (account && isRegistered) {
      const btnLike = document.createElement("button");
      btnLike.className = "action-btn";
      btnLike.textContent = "👍 Like";
      btnLike.addEventListener("click", () => tipFlow(p.id));
      const btnCmt = document.createElement("button");
      btnCmt.className = "action-btn";
      btnCmt.textContent = "💬 Comment";
      btnCmt.addEventListener("click", () => commentFlow(p));
      const btnShare = document.createElement("button");
      btnShare.className = "action-btn";
      btnShare.textContent = "🔁 Share";
      btnShare.addEventListener("click", () => shareFlow(p));
      act.appendChild(btnLike); act.appendChild(btnCmt); act.appendChild(btnShare);
    }
    card.appendChild(head); card.appendChild(content); card.appendChild(act);
    elFeedList.appendChild(card);
  }
}

/* ACTIONS dưới bài — map theo hợp đồng FrollSocial */
async function tipFlow(postId) {
  try {
    if (!account) await connectWallet(); if (!isRegistered) return alert("Please register first.");
    const amountStr = prompt("Tip amount in FROLL (e.g., 0.01):", "0.01"); const v = parseFloat(amountStr || "0"); if (!(v > 0)) return;
    const units = ethers.utils.parseUnits(String(v), FROLL_DECIMALS);
    const erc = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    const allow = await erc.allowance(account, SOCIAL_ADDR);
    if (allow.lt(units)) { const tx1 = await erc.approve(SOCIAL_ADDR, units); await tx1.wait(); }
    const tx = await social.tipPost(postId, units);
    await tx.wait(); alert("Tipped ✔");
  } catch (e) { console.error(e); alert("Tip failed."); }
}

async function commentFlow(p) {
  try {
    if (!account) await connectWallet(); if (!isRegistered) return alert("Please register first.");
    const text = prompt("Your comment:", ""); if (!text) return;
    const content = `Reply to #${p.id} (${shorten(p.author)}):\n\n${text}`;
    const maxBytes = await new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, getRO()).MAX_POST_BYTES();
    const enc = new TextEncoder().encode(content); if (enc.length > Number(maxBytes)) return alert("Comment too long.");
    const tx = await social.createPost(content); await tx.wait(); alert("Comment posted ✔"); refreshFeed();
  } catch (e) { console.error(e); alert("Comment failed."); }
}

function shareFlow(p) {
  const url = `${location.origin}${location.pathname}#post-${p.id}`;
  const text = `Post #${p.id} by ${p.author}\n\n${p.content}`;
  if (navigator.share) { navigator.share({ title: `Post #${p.id}`, text, url }).catch(() => { }); }
  else {
    const payload = `${url}\n\n${text}`;
    navigator.clipboard?.writeText(payload).then(() => alert("Copied to clipboard ✔")).catch(() => {
      prompt("Copy this", payload);
    });
  }
}

/* QUICK NAV */
$("qn-home").addEventListener("click", () => { elFeedAddr.value = ""; refreshFeed(); window.scrollTo({ top: 0, behavior: "smooth" }); });
$("qn-profile").addEventListener("click", async () => { if (!account) await connectWallet(); if (account) { elFeedAddr.value = account; refreshFeed(); window.scrollTo({ top: 0, behavior: "smooth" }); } });
$("qn-newpost").addEventListener("click", async () => { if (!account) await connectWallet(); if (account) { document.getElementById("composer").scrollIntoView({ behavior: "smooth" }); elPostContent.focus(); } });
$("btn-search").addEventListener("click", refreshFeed);

/* INIT */
setGuestUI();
setSwapDirection("VIC2FROLL");
refreshFeed();
