// NETWORK & CONTRACTS
const VIC_CHAIN = {
  chainId: "0x58",
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: ["https://rpc.viction.xyz","https://viction.blockpi.network/v1/rpc/public"],
  blockExplorerUrls: ["https://vicscan.xyz"]
};
const FROLL_ADDR = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const SWAP_ADDR = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068";
const SOCIAL_ADDR = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82";

// ABIs
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256) ",
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
  "function tipPost(uint256 postId, uint256 amount)"
];

let roProvider, provider, signer, account, froll, swap, social;
let isRegistered = false;
let swapDirection = "VIC2FROLL";

// DOM
const $ = (id)=>document.getElementById(id);
const elBadgeFroll = $("badge-froll"), elBadgeVic = $("badge-vic"), elStatus = $("wallet-status"), elConnectBtn = $("connect-wallet");
const elOpenSwap = $("btn-open-swap");

// CONNECT / DISCONNECT
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
  } catch (e) {
    console.error(e);
    alert("Connect failed or rejected.");
    setGuestUI();
  } finally {
    elConnectBtn.disabled = false;
  }
}

function setConnectedUI() {
  elStatus.textContent = shorten(account);
  elConnectBtn.textContent = "Disconnect";
}

function setGuestUI() {
  elStatus.textContent = "Not connected";
  elConnectBtn.textContent = "Connect Wallet";
}

function softDisconnect() {
  provider = signer = froll = swap = social = undefined;
  account = undefined;
  isRegistered = false;
  setGuestUI();
}

async function ensureViction(eth) {
  const cid = await eth.request({method:"eth_chainId"});
  if (cid?.toLowerCase() === VIC_CHAIN.chainId) return;
  try {
    await eth.request({method:"wallet_switchEthereumChain", params:[{chainId:VIC_CHAIN.chainId}]});
  } catch (e) {
    if (e?.code === 4902) {
      await eth.request({method:"wallet_addEthereumChain", params:[VIC_CHAIN]});
    } else throw e;
  }
}
