// app.js — Froll.net (VinSocial-style Social + Swap overlay)

/* NETWORK & CONTRACTS */
const VIC_CHAIN = {
  chainId: "0x58",
  chainName: "Viction Mainnet",
  nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
  rpcUrls: ["https://rpc.viction.xyz","https://viction.blockpi.network/v1/rpc/public"],
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

/* STATE */
let roProvider, provider, signer, account, froll, swap, social;
let isRegistered = false;
let swapDirection = "VIC2FROLL";

/* DOM */
const $ = (id)=>document.getElementById(id);
// brand / wallet
const elBadgeFroll = $("badge-froll"), elBadgeVic = $("badge-vic"), elStatus = $("wallet-status"), elConnectBtn = $("connect-wallet");
// quick nav
const elQHome=$("qn-home"), elQProfile=$("qn-profile"), elQNew=$("qn-newpost"), elFeedAddr=$("feed-address"), elBtnSearch=$("btn-search");
// composer
const elComposer=$("composer"), elRegister=$("register-account"), elPostContent=$("post-content"), elPostMedia=$("post-media"), elPublish=$("btn-publish"), elComposeMsg=$("compose-msg");
// feed
const elFeedList=$("feed-list"), elFeedMsg=$("feed-msg");
// swap
const elOpenSwap=$("btn-open-swap"), elSwapView=$("swap-view"), elBackHome=$("btn-back-home"), elBtnDisco=$("btn-disconnect");
const elFromLogo=$("from-token-logo"), elToLogo=$("to-token-logo"), elFromInfo=$("from-token-info"), elToInfo=$("to-token-info");
const elFromAmount=$("from-amount"), elToAmount=$("to-amount"), elMaxBtn=$("max-button"), elSwapDir=$("swap-direction"), elSwapNow=$("swap-now"), elGasFee=$("gas-fee");

/* HELPERS */
const fmt=(n,d=6)=>Number(n).toLocaleString(undefined,{ maximumFractionDigits:d });
const shorten=(a="")=>a?`${a.slice(0,6)}…${a.slice(-4)}`:"";
const getRO=()=> (roProvider ||= new ethers.providers.JsonRpcProvider(VIC_CHAIN.rpcUrls[0]));
async function ensureViction(eth){
  const cid = await eth.request({method:"eth_chainId"});
  if (cid?.toLowerCase()===VIC_CHAIN.chainId) return;
  try{ await eth.request({method:"wallet_switchEthereumChain", params:[{chainId:VIC_CHAIN.chainId}]}); }
  catch(e){ if(e?.code===4902){ await eth.request({method:"wallet_addEthereumChain", params:[VIC_CHAIN]}); } else throw e; }
}
function setGuestUI(){
  elStatus.textContent="Not connected";
  elConnectBtn.textContent="Connect Wallet";
  elBadgeVic.style.display="none"; elBadgeFroll.style.display="none";
  elComposer.style.display="none";
}
function setConnectedUI(){
  elStatus.textContent=shorten(account);
  elConnectBtn.textContent="Disconnect";
  elComposer.style.display="grid";
}

/* CONNECT / DISCONNECT */
async function connectWallet(){
  if (account){ softDisconnect(); return; } // toggle = disconnect
  const eth=window.ethereum; if(!eth) return alert("MetaMask not detected.");
  elConnectBtn.disabled=true; elConnectBtn.textContent="Connecting…"; elStatus.textContent="Connecting…";
  try{
    await ensureViction(eth);
    provider=new ethers.providers.Web3Provider(eth,"any");
    await provider.send("eth_requestAccounts",[]);
    signer=provider.getSigner(); account=await signer.getAddress();
    froll=new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
    swap =new ethers.Contract(SWAP_ADDR,  SWAP_ABI,  signer);
    social=new ethers.Contract(SOCIAL_ADDR,SOCIAL_ABI,signer);
    setConnectedUI();
    await Promise.all([refreshBalances()]);
    await checkRegistered();         // ⬅️ đảm bảo cập nhật biến isRegistered
    await refreshFeed();             // ⬅️ re-render feed để hiện nút 👍💬🔁
    if (document.body.classList.contains("swap-open")) await refreshSwapBalances();
  }catch(e){ console.error(e); alert("Connect failed or rejected."); setGuestUI(); }
  finally{ elConnectBtn.disabled=false; }
}
function softDisconnect(){
  provider=signer=froll=swap=social=undefined; account=undefined; isRegistered=false;
  setGuestUI(); refreshFeed();                 // ⬅️ render lại để ẩn nút hành động
  if (document.body.classList.contains("swap-open")) closeSwap();
}

/* FEED (READ-ONLY) */
async function latestIds(limit=20){
  const ro=new ethers.Contract(SOCIAL_ADDR,SOCIAL_ABI,getRO());
  const next=await ro.nextPostId().then(n=>Number(n)).catch(()=>0);
  if(!next) return [];
  const start=next, end=Math.max(1,start-limit+1), ids=[]; for(let i=start;i>=end;i--) ids.push(i);
  return ids;
}
async function fetchLatestPosts(limit=20){
  const ro=new ethers.Contract(SOCIAL_ADDR,SOCIAL_ABI,getRO());
  const ids=await latestIds(limit); if(!ids.length) return [];
  const posts=await Promise.all(ids.map(async id=>{ try{ return await ro.getPost(id);}catch{return null;} }));
  return posts.filter(Boolean);
}

/* WRITE */
elRegister.addEventListener("click", async ()=>{
  try{
    if(!account) await connectWallet();
    const fee=await social.registerFee();
    const erc=new ethers.Contract(FROLL_ADDR,ERC20_ABI,signer);
    const allow=await erc.allowance(account,SOCIAL_ADDR);
    if(allow.lt(fee)){ const tx1=await erc.approve(SOCIAL_ADDR,fee); await tx1.wait(); }
    const tx=await social.register(); elComposeMsg.textContent=`Registering… tx: ${tx.hash}`;
    await tx.wait(); elComposeMsg.textContent=`Registered successfully ✔`;
    isRegistered=true; elRegister.style.display="none";
    await Promise.all([refreshBalances(), refreshFeed()]);   // ⬅️ vẽ lại feed để xuất hiện nút
  }catch(e){ console.error(e); elComposeMsg.textContent=`Register failed.`; alert("Register failed or rejected."); }
});

elPublish.addEventListener("click", async ()=>{
  try{
    if(!account) await connectWallet();
    if(!isRegistered){ isRegistered=await social.isRegistered(account); if(!isRegistered) return alert("Please register your account first (0.001 FROLL)."); }
    const content=(elPostContent.value||"").trim(); const media=(elPostMedia.value||"").trim();
    if(!content && !media) return alert("Please write something or add a media URL.");
    const full=media ? `${content}\n\n${media}` : content;
    const maxBytes=await new ethers.Contract(SOCIAL_ADDR,SOCIAL_ABI,getRO()).MAX_POST_BYTES();
    const enc=new TextEncoder().encode(full); if(enc.length>Number(maxBytes)) return alert(`Content too large. Max ${maxBytes} bytes.`);
    const tx=await social.createPost(full); elComposeMsg.textContent=`Publishing… tx: ${tx.hash}`;
    await tx.wait(); elComposeMsg.textContent=`Post published ✔`; elPostContent.value=""; elPostMedia.value="";
    refreshFeed();
  }catch(e){ console.error(e); elComposeMsg.textContent=`Publish failed.`; alert("Publish failed or rejected."); }
});

/* Actions dưới bài — map theo hợp đồng FrollSocial */
async function tipFlow(postId){
  try{
    if(!account) await connectWallet(); if(!isRegistered) return alert("Please register first.");
    const amountStr=prompt("Tip amount in FROLL (e.g., 0.01):","0.01"); const v=parseFloat(amountStr||"0"); if(!(v>0)) return;
    const units=ethers.utils.parseUnits(String(v),FROLL_DECIMALS);
    const erc=new ethers.Contract(FROLL_ADDR,ERC20_ABI,signer);
    const allow=await erc.allowance(account, SOCIAL_ADDR);
    if(allow.lt(units)){ const tx1=await erc.approve(SOCIAL_ADDR,units); await tx1.wait(); }
    const tx=await social.tipPost(postId, units);
    await tx.wait(); alert("Tipped ✔");
  }catch(e){ console.error(e); alert("Tip failed."); }
}

async function commentFlow(p){
  try{
    if(!account) await connectWallet(); if(!isRegistered) return alert("Please register first.");
    const text=prompt("Your comment:",""); if(!text) return;
    const content=`Reply to #${p.id} (${shorten(p.author)}):\n\n${text}`;
    const maxBytes=await new ethers.Contract(SOCIAL_ADDR,SOCIAL_ABI,getRO()).MAX_POST_BYTES();
    const enc=new TextEncoder().encode(content); if(enc.length>Number(maxBytes)) return alert("Comment too long.");
    const tx=await social.createPost(content); await tx.wait(); alert("Comment posted ✔"); refreshFeed();
  }catch(e){ console.error(e); alert("Comment failed."); }
}

function shareFlow(p){
  const url = `${location.origin}${location.pathname}#post-${p.id}`;
  const text = `Post #${p.id} by ${p.author}\n\n${p.content}`;
  if (navigator.share) { navigator.share({ title: `Post #${p.id}`, text, url }).catch(()=>{}); }
  else {
    const payload = `${url}\n\n${text}`;
    navigator.clipboard?.writeText(payload).then(()=>alert("Copied to clipboard ✔")).catch(()=>{
      prompt("Copy this", payload);
    });
  }
}

/* SWAP (overlay) */
function openSwap(){ document.body.classList.add("swap-open"); elSwapView.style.display="block"; if(!account) connectWallet().then(()=>refreshSwapBalances()); else refreshSwapBalances(); }
function closeSwap(){ document.body.classList.remove("swap-open"); elSwapView.style.display="none"; }
elOpenSwap.addEventListener("click", openSwap);
elBackHome.addEventListener("click", closeSwap);
elBtnDisco.addEventListener("click", ()=>{ softDisconnect(); closeSwap(); });
