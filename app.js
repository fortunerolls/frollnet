/* NETWORK & CONTRACTS */
const VIC_CHAIN = {
  chainId: "0x58",
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: ["https://rpc.viction.xyz", "https://viction.blockpi.network/v1/rpc/public"],
  blockExplorerUrls: ["https://vicscan.xyz"]
};
const FROLL_ADDR = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const SWAP_ADDR = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068";
const SOCIAL_ADDR = "0x28c642682b1E1458d922C4226a7192F5B8953A74";
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
  "function MAX_POST_BYTES() view returns (uint256)",
  "function registerFee() view returns (uint256)",
  "function isRegistered(address) view returns (bool)",
  "function nextPostId() view returns (uint256)",
  "function getUserPosts(address) view returns (uint256[] memory)",
  "function getPost(uint256) view returns (tuple(uint256 id, address author, string content, uint64 timestamp))",
  "function register()", "function createPost(string calldata content) returns (uint256 id)",
  "function tipPost(uint256 postId, uint256 amount)",
  "function follow(address user) returns (bool)",
  "function unfollow(address user) returns (bool)",
  "function getFollowers(address user) view returns (uint256)",
  "function getLikes(uint256 postId) view returns (uint256)"
];

/* STATE */
let roProvider, provider, signer, account, froll, swap, social;
let isRegistered = false;
let swapDirection = "VIC2FROLL";

/* DOM */
const $ = (id) => document.getElementById(id);

// Elements for follow/like
const elFollowBtn = $("follow-btn"), elLikeBtn = $("like-btn");
const elFollowCount = $("follow-count"), elLikeCount = $("like-count");

// brand / wallet
const elBadgeFroll = $("badge-froll"), elBadgeVic = $("badge-vic"), elStatus = $("wallet-status"), elConnectBtn = $("connect-wallet");

// Composer and Feed
const elFeedList = $("feed-list"), elFeedMsg = $("feed-msg");
const elRegister = $("register-account"), elPostContent = $("post-content"), elPostMedia = $("post-media"), elPublish = $("btn-publish");
const elComposeMsg = $("compose-msg");

/* HELPERS */
const fmt = (n, d = 6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (a = "") => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";

async function ensureViction(eth) {
  const cid = await eth.request({ method: "eth_chainId" });
  if (cid?.toLowerCase() === VIC_CHAIN.chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: VIC_CHAIN.chainId }] });
  } catch (e) {
    if (e?.code === 4902) { await eth.request({ method: "wallet_addEthereumChain", params: [VIC_CHAIN] }); }
    else throw e;
  }
}

function setGuestUI() {
  elStatus.textContent = "Not connected";
  elConnectBtn.textContent = "Connect Wallet";
  elBadgeVic.style.display = "none"; elBadgeFroll.style.display = "none";
  elFeedList.innerHTML = `<div class="meta meta-center">Please connect your wallet to interact.</div>`;
}

function setConnectedUI() {
  elStatus.textContent = shorten(account);
  elConnectBtn.textContent = "Disconnect";
  elBadgeVic.style.display = "inline-block"; elBadgeFroll.style.display = "inline-block";
  refreshFeed();
}

/* CONNECT / DISCONNECT */
async function connectWallet() {
  if (account) { softDisconnect(); return; } // toggle = disconnect
  const eth = window.ethereum; if (!eth) return alert("MetaMask not detected.");
  elConnectBtn.disabled = true; elConnectBtn.textContent = "Connecting…"; elStatus.textContent = "Connecting…";
  try {
    await ensureViction(eth);
    provider = new ethers.providers.Web3Provider(eth, "any");
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner(); account = await signer.getAddress();
    froll = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    swap = new ethers.Contract(SWAP_ADDR, SWAP_ABI, signer);
    social = new ethers.Contract(SOCIAL_ADDR, SOCIAL_ABI, signer);
    setConnectedUI();
    await Promise.all([refreshBalances()]);
    await checkRegistered();
  } catch (e) { console.error(e); alert("Connect failed or rejected."); setGuestUI(); }
  finally { elConnectBtn.disabled = false; }
}

function softDisconnect() {
  provider = signer = froll = swap = social = undefined; account = undefined; isRegistered = false;
  setGuestUI();
}

/* FOLLOW & LIKE */
async function toggleFollow() {
  try {
    if (!account) await connectWallet();
    const isFollowing = await social.getFollowers(account);
    const isFollowed = isFollowing > 0;
    const tx = isFollowed ? await social.unfollow(account) : await social.follow(account);
    await tx.wait();
    alert(isFollowed ? "Unfollowed" : "Followed");
    refreshFollowers();
  } catch (e) { console.error(e); alert("Follow action failed."); }
}

async function toggleLike(postId) {
  try {
    if (!account) await connectWallet();
    const tx = await social.tipPost(postId, ethers.utils.parseUnits("0.01", FROLL_DECIMALS)); // Example amount
    await tx.wait();
    alert("Liked successfully!");
    refreshLikes(postId);
  } catch (e) { console.error(e); alert("Like action failed."); }
}

async function refreshFollowers() {
  const followers = await social.getFollowers(account);
  elFollowCount.textContent = `${followers} Followers`;
}

async function refreshLikes(postId) {
  const likes = await social.getLikes(postId);
  elLikeCount.textContent = `${likes} Likes`;
}

/* FEED */
async function refreshFeed() {
  try {
    elFeedMsg.textContent = "Loading posts...";
    const posts = await fetchLatestPosts(20);
    renderFeed(posts);
    elFeedMsg.textContent = "Loaded posts.";
  } catch (e) {
    console.error(e); elFeedMsg.textContent = "Failed to load posts.";
  }
}

async function renderFeed(posts) {
  elFeedList.innerHTML = "";
  posts.forEach(post => {
    const postElement = document.createElement("div");
    postElement.classList.add("post");
    postElement.innerHTML = `
      <div class="post-header">${shorten(post.author)} • #${post.id}</div>
      <div class="post-content">${post.content}</div>
      <div class="post-actions">
        <button onclick="toggleLike(${post.id})">👍 Like</button>
        <button onclick="toggleFollow()">Follow</button>
        <span>Likes: <span id="like-count-${post.id}">0</span></span>
      </div>
    `;
    elFeedList.appendChild(postElement);
  });
}
