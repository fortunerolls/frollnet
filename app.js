/* NETWORK & CONTRACTS */
const VIC_CHAIN = {
  chainId: "0x58",
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: ["https://rpc.viction.xyz", "https://viction.blockpi.network/v1/rpc/public"],
  blockExplorerUrls: ["https://vicscan.xyz"]
};

const FROLL_ADDR = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // Địa chỉ FROLL token trên mạng VIC
const SWAP_ADDR = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068"; // Địa chỉ hợp đồng Swap FROLL/VIC
const SOCIAL_ADDR = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82"; // Địa chỉ hợp đồng mạng xã hội FrollSocial
const FROLL_DECIMALS = 18;
const RATIO_VIC_PER_FROLL = 100; // Tỷ lệ FROLL/VIC

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
  "function register()",
  "function createPost(string calldata content) returns (uint256 id)",
  "function tipPost(uint256 postId, uint256 amount)",
  "function followPost(uint256 postId)"
];

/* STATE */
let provider, signer, account, froll, swap, social;
let isRegistered = false;
let swapDirection = "VIC2FROLL";

/* DOM */
const $ = (id) => document.getElementById(id);
// brand / wallet
const elBadgeFroll = $("badge-froll"), elBadgeVic = $("badge-vic"), elStatus = $("wallet-status"), elConnectBtn = $("connect-wallet");
// quick nav
const elQHome = $("qn-home"), elQProfile = $("qn-profile"), elQNew = $("qn-newpost"), elFeedAddr = $("feed-address"), elBtnSearch = $("btn-search");
// composer
const elComposer = $("composer"), elRegister = $("register-account"), elPostContent = $("post-content"), elPostMedia = $("post-media"), elPublish = $("btn-publish"), elComposeMsg = $("compose-msg");
// feed
const elFeedList = $("feed-list"), elFeedMsg = $("feed-msg");
// swap
const elOpenSwap = $("btn-open-swap"), elSwapView = $("swap-view"), elBackHome = $("btn-back-home"), elBtnDisco = $("btn-disconnect");
const elFromLogo = $("from-token-logo"), elToLogo = $("to-token-logo"), elFromInfo = $("from-token-info"), elToInfo = $("to-token-info");
const elFromAmount = $("from-amount"), elToAmount = $("to-amount"), elMaxBtn = $("max-button"), elSwapDir = $("swap-direction"), elSwapNow = $("swap-now"), elGasFee = $("gas-fee");

/* HELPERS */
const fmt = (n, d = 6) => Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
const shorten = (a = "") => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
const getRO = () => provider || new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]);

// Connect to Viction network
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
  if (account) { softDisconnect(); return; }
  const eth = window.ethereum;
  if (!eth) return alert("MetaMask not detected.");
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
    await checkRegistered();
    await refreshFeed();
    if (document.body.classList.contains("swap-open")) await refreshSwapBalances();
  } catch (e) {
    console.error(e);
    alert("Connect failed or rejected.");
    setGuestUI();
  } finally { elConnectBtn.disabled = false; }
}

function softDisconnect() {
  provider = signer = froll = swap = social = undefined;
  account = undefined;
  isRegistered = false;
  setGuestUI();
  refreshFeed();
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
      await checkRegistered();
      await refreshFeed();
      refreshSwapBalances().catch(() => { });
    } else { softDisconnect(); }
  });
  window.ethereum.on?.("chainChanged", (cid) => {
    if (cid?.toLowerCase() !== VIC_CHAIN.chainId) elStatus.textContent = "Wrong network";
    else if (account) elStatus.textContent = shorten(account);
  });
}
