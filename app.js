/* =========================================================
   Froll.net — On-chain Social + Swap (stable, self-contained)
   - Works with your latest index.html + style.css
   - Auto-loads ethers v5.7 if missing
   - VIC mainnet (chainId 88)
========================================================= */

/* ---------- Addresses & Network ---------- */
const FROLL_SOCIAL_ADDRESS  = "0x28c642682b1E1458d922C4226a7192F5B8953A74";
const FROLL_TOKEN_ADDRESS   = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const SWAP_CONTRACT_ADDRESS = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068";

const VIC_RPC        = "https://rpc.viction.xyz";
const VIC_CHAIN_ID_HEX = "0x58"; // 88
const VIC_PARAMS = {
  chainId: VIC_CHAIN_ID_HEX,
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: [VIC_RPC],
  blockExplorerUrls: ["https://vicscan.xyz/"]
};

/* ---------- Swap constants ---------- */
const FIXED_RATE_FROLL_VIC = 100;  // 1 FROLL = 100 VIC
const FIXED_FEE_VIC        = 0.01; // 0.01 VIC fee per swap

/* ---------- Minimal ABIs ---------- */
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const FROLL_SOCIAL_ABI = [
  "constructor(address frollToken)",
  "function FROLL() view returns (address)",
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function register()",
  "function createPost(string content) returns (uint256)",
  "function getPost(uint256 id) view returns (tuple(uint256 id,address author,string content,uint64 timestamp))"
];

const SWAP_ABI = [
  "function swapVicToFroll() payable",
  "function swapFrollToVic(uint256 frollAmount)"
];

/* ---------- State ---------- */
let ethersReady = false;
let provider, signer, account;
let frollToken, frollSocial, swapContract;
let frollDecimals = 18;

/* ---------- Shorthands & helpers ---------- */
const $ = (s) => document.querySelector(s);
function shortAddr(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : "Not connected"; }
function escapeHtml(str){ return (str||"").replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function linkify(text){
  const re = /\b(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)\b/gi;
  return (text||"").replace(re, (u) => {
    const href = u.startsWith("http") ? u : `https://${u}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${u}</a>`;
  });
}
function bytesUtf8(s){ return new TextEncoder().encode(s||"").length; }
function formatTime(ts){ return new Date(Number(ts) * 1000).toLocaleString(); }
const store = {
  get(k, d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v){ localStorage.setItem(k, JSON.stringify(v)); }
};

/* ---------- Ethers loader (if missing) ---------- */
async function ensureEthers() {
  if (window.ethers && window.ethers.providers) { ethersReady = true; return; }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/ethers@5.7.2/dist/ethers.min.js";
    s.onload = () => { ethersReady = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load ethers.js"));
    document.head.appendChild(s);
  });
}

/* ---------- Wallet & Chain ---------- */
async function ensureVICChain() {
  const eth = window.ethereum;
  if (!eth) throw new Error("No wallet found");
  const current = await eth.request({ method: "eth_chainId" });
  if ((current||"").toLowerCase() === VIC_CHAIN_ID_HEX) return true;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN_ID_HEX }] });
    return true;
  } catch (e) {
    if (e?.code === 4902 || /Unrecognized chain/i.test(e?.message||"")) {
      await eth.request({ method: "wallet_addEthereumChain", params: [VIC_PARAMS] });
      return true;
    }
    throw e;
  }
}

async function connectWallet() {
  try {
    await ensureEthers();
    await ensureVICChain();
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await provider.send("eth_requestAccounts", []);
    signer  = provider.getSigner();
    account = await signer.getAddress();

    frollToken   = new ethers.Contract(FROLL_TOKEN_ADDRESS, ERC20_ABI, signer);
    frollSocial  = new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, signer);
    swapContract = new ethers.Contract(SWAP_CONTRACT_ADDRESS, SWAP_ABI, signer);
    try { frollDecimals = await frollToken.decimals(); } catch {}

    $("#connect-wallet").textContent = "Disconnect";
    $("#connect-wallet").dataset.connected = "1";
    $("#connect-wallet").classList.remove("secondary");
    $("#connect-wallet").classList.add("primary");

    // enable swap now
    $("#swap-now").disabled = false;

    // show wallet addr somewhere (reuse price pill’s sibling if needed)
    const priceEl = $("#froll-price-usd");
    if (priceEl) priceEl.insertAdjacentHTML("afterend", ` <span class="meta">| ${shortAddr(account)}</span>`);

    await refreshRegisterState();
    await refreshFeed();
  } catch (e) {
    console.error(e);
    alert("Connect failed. Please approve wallet requests and ensure VIC network is selected.");
  }
}

function disconnectUi() {
  provider = signer = account = null;
  $("#connect-wallet").textContent = "Connect Wallet";
  $("#connect-wallet").dataset.connected = "0";
}

/* ---------- Approvals ---------- */
async function ensureApproval(token, owner, spender, amountWei) {
  const cur = await token.allowance(owner, spender);
  if (cur.gte(amountWei)) return;
  const tx = await token.approve(spender, amountWei);
  await tx.wait();
}

/* ---------- Registration & Compose ---------- */
function injectRegisterButton() {
  if ($("#register-account")) return;
  const container = $("#create-post");
  if (!container) return;
  const btn = document.createElement("button");
  btn.id = "register-account";
  btn.className = "btn secondary";
  btn.textContent = "Register (0.001 FROLL)";
  btn.addEventListener("click", onRegister);
  container.insertBefore(btn, container.firstChild);
}

async function refreshRegisterState() {
  injectRegisterButton();
  if (!signer) { $("#register-account")?.setAttribute("disabled","true"); return; }
  const reg = await frollSocial.isRegistered(account);
  const btn = $("#register-account");
  if (btn) {
    btn.textContent = reg ? "Registered" : "Register (0.001 FROLL)";
    btn.disabled = reg ? true : false;
  }
}

async function onRegister() {
  if (!signer) return alert("Connect wallet first.");
  try {
    const fee = await frollSocial.registerFee();
    await ensureApproval(frollToken, account, FROLL_SOCIAL_ADDRESS, fee);
    const tx = await frollSocial.register();
    $("#register-account").disabled = true;
    await tx.wait();
    await refreshRegisterState();
    alert("Registration successful!");
  } catch (e) {
    console.error(e);
    alert("Registration failed.");
  }
}

function buildOnchainContent() {
  const title = ($("#post-title")?.value||"").trim();
  const body  = ($("#post-content")?.value||"").trim();
  const media = ($("#post-media")?.value||"").trim();
  const parts = [];
  if (title) parts.push(title);
  if (body)  parts.push(body);
  if (media) parts.push(`Media: ${media}`);
  return parts.join("\n\n");
}

async function onPost() {
  if (!signer) return alert("Connect wallet first.");
  try {
    const content = buildOnchainContent();
    if (!content) return alert("Please enter something to post.");
    const limit = await frollSocial.MAX_POST_BYTES();
    const size  = bytesUtf8(content);
    if (size > limit.toNumber()) return alert(`Post exceeds ${limit.toString()} bytes.`);

    const reg = await frollSocial.isRegistered(account);
    if (!reg) return alert("Please register first (0.001 FROLL).");

    const tx = await frollSocial.createPost(content);
    $("#submit-post").disabled = true;
    await tx.wait();
    $("#submit-post").disabled = false;
    // reset fields
    $("#post-title").value = "";
    $("#post-content").value = "";
    $("#post-media").value = "";
    await refreshFeed();
  } catch (e) {
    console.error(e);
    alert("Posting failed.");
  }
}

/* ---------- Feed & Social (frontend) ---------- */
function likeKey(id){ return `froll_like_${id}`; }
function followKey(a){ return `froll_follow_${(a||"").toLowerCase()}`; }
function isLiked(id){ return !!store.get(likeKey(id), false); }
function toggleLike(id){ const v=!isLiked(id); store.set(likeKey(id), v); return v; }
function isFollowed(a){ return !!store.get(followKey(a), false); }
function toggleFollow(a){ const v=!isFollowed(a); store.set(followKey(a), v); return v; }

function renderMedia(url) {
  if (!url) return "";
  const isImg = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url);
  const isVid = /\.(mp4|webm|ogg|mov)$/i.test(url);
  if (isImg) return `<div class="media"><img src="${url}" loading="lazy" alt="media"/></div>`;
  if (isVid) return `<div class="media"><video src="${url}" controls></video></div>`;
  return "";
}

function parseContent(content) {
  // Split by two newlines: [title?, body?, media?]
  const parts = (content||"").split(/\n\s*\n/);
  let title = "", body = "", mediaUrl = "";
  if (parts.length) {
    title = parts[0] || "";
    if (parts.length >= 2) body = parts[1] || "";
    if (parts.length >= 3) {
      const m = parts.slice(2).join("\n\n");
      const mt = m.match(/Media:\s*(.+)$/i);
      mediaUrl = mt ? mt[1].trim() : "";
      if (!mt) body = [body, m].filter(Boolean).join("\n\n"); // fallback
    }
  }
  return { title, body, mediaUrl };
}

async function refreshFeed() {
  const root = $("#posts-container");
  if (!root) return;
  root.innerHTML = "";
  try {
    // read-only provider if no signer yet
    const ro = signer ? signer.provider : new ethers.providers.JsonRpcProvider(VIC_RPC);
    const contract = signer ? frollSocial : new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, ro);

    const countBN = await contract.nextPostId();
    const last = countBN.toNumber();
    if (last === 0) {
      root.innerHTML = `<div class="meta">No posts yet. Be the first!</div>`;
      return;
    }
    const start = Math.max(1, last - 49);
    for (let id = last; id >= start; id--) {
      const p = await contract.getPost(id);
      const parsed = parseContent(p.content);
      const contentHtml = linkify(escapeHtml(parsed.body));
      const liked = isLiked(id);
      const followed = isFollowed(p.author);
      const mediaHtml = renderMedia(parsed.mediaUrl);

      const el = document.createElement("div");
      el.className = "post";
      el.id = `post-${id}`;
      el.innerHTML = `
        <div class="head">
          <span>${shortAddr(p.author)}</span>
          <span>${formatTime(p.timestamp)}</span>
        </div>
        ${parsed.title ? `<div class="title">${escapeHtml(parsed.title)}</div>` : ""}
        <div class="content">${contentHtml}</div>
        ${mediaHtml}
        <div class="actions">
          <span class="chip ${liked?'active':''}" data-action="like" data-id="${id}">👍 Like</span>
          <span class="chip ${followed?'active':''}" data-action="follow" data-author="${p.author}">👤 Follow</span>
          <span class="chip" data-action="share" data-id="${id}">🔗 Share</span>
        </div>
      `;
      root.appendChild(el);
    }
  } catch (e) {
    console.error("refreshFeed:", e);
    root.innerHTML = `<div class="meta">Failed to load feed.</div>`;
  }
}

function setupFeedActions() {
  $("#posts-container").addEventListener("click", async (e) => {
    const el = e.target.closest(".chip");
    if (!el) return;
    const act = el.dataset.action;
    if (act === "like") {
      const id = Number(el.dataset.id);
      el.classList.toggle("active", toggleLike(id));
    } else if (act === "follow") {
      const a = el.dataset.author;
      el.classList.toggle("active", toggleFollow(a));
    } else if (act === "share") {
      const id = el.dataset.id;
      const url = `${location.origin}${location.pathname}#post-${id}`;
      if (navigator.share) {
        try { await navigator.share({ title: "Froll.net post", url }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(url); alert("Post link copied!"); } catch { alert(url); }
      }
    }
  });
}

/* ---------- Swap ---------- */
function recalcSwapPreview() {
  const fromSel = $("#swap-from-token").value;
  const toSel   = fromSel === "VIC" ? "FROLL" : "VIC";
  $("#swap-to-token").value = toSel;
  const amt = parseFloat($("#swap-from-amount").value || "0");
  let out = 0;
  if (isFinite(amt) && amt > 0) {
    if (fromSel === "VIC") out = amt / FIXED_RATE_FROLL_VIC;
    else out = amt * FIXED_RATE_FROLL_VIC;
  }
  $("#swap-to-amount").value = out ? out.toString() : "";
}

async function doSwap() {
  if (!signer) return alert("Connect wallet first.");
  try {
    const fromSel = $("#swap-from-token").value;
    const amtN = parseFloat($("#swap-from-amount").value || "0");
    if (!isFinite(amtN) || amtN <= 0) return alert("Enter a valid amount.");

    if (fromSel === "VIC") {
      const value = ethers.utils.parseEther((amtN + FIXED_FEE_VIC).toString());
      const tx = await swapContract.swapVicToFroll({ value });
      $("#swap-now").disabled = true;
      await tx.wait();
      $("#swap-now").disabled = false;
      alert("Swapped VIC → FROLL successfully.");
    } else { // FROLL → VIC
      const frollWei = ethers.utils.parseUnits(amtN.toString(), frollDecimals);
      await ensureApproval(frollToken, account, SWAP_CONTRACT_ADDRESS, frollWei);
      const tx = await swapContract.swapFrollToVic(frollWei, { value: ethers.utils.parseEther(FIXED_FEE_VIC.toString()) });
      $("#swap-now").disabled = true;
      await tx.wait();
      $("#swap-now").disabled = false;
      alert("Swapped FROLL → VIC successfully.");
    }
  } catch (e) {
    console.error(e);
    alert("Swap failed. Try again or check wallet/network.");
  }
}

/* ---------- UI Wiring ---------- */
function setupUi() {
  // Connect
  const cbtn = $("#connect-wallet");
  if (cbtn) {
    cbtn.addEventListener("click", async () => {
      if (cbtn.dataset.connected === "1") {
        disconnectUi();
      } else {
        await connectWallet();
      }
    });
  }

  // Toggle swap interface
  $("#toggle-swap").addEventListener("click", () => {
    const panel = $("#swap-interface");
    const v = panel.style.display === "none" || panel.style.display === "" ? "block" : "none";
    panel.style.display = v;
  });

  // Compose post
  $("#submit-post").addEventListener("click", onPost);

  // Swap input changes
  $("#swap-from-token").addEventListener("change", recalcSwapPreview);
  $("#swap-from-amount").addEventListener("input", recalcSwapPreview);

  // Swap now
  $("#swap-now").addEventListener("click", doSwap);

  // Feed actions
  setupFeedActions();
}

/* ---------- Init ---------- */
(async function init() {
  try {
    await ensureEthers();
  } catch (e) {
    console.error("ethers load error:", e);
  }

  // Read-only feed on first load
  try {
    const ro = new ethers.providers.JsonRpcProvider(VIC_RPC);
    frollSocial = new ethers.Contract(FROLL_SOCIAL_ADDRESS, FROLL_SOCIAL_ABI, ro);
    await refreshFeed();
  } catch (e) {
    console.warn("RO init failed:", e);
  }

  setupUi();

  if (window.ethereum) {
    window.ethereum.on?.("accountsChanged", () => location.reload());
    window.ethereum.on?.("chainChanged",  () => location.reload());
  }
})();
