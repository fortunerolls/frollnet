const frollSocialAddress = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82"; // Địa chỉ hợp đồng FrollSocial
const frollTokenAddress = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // Địa chỉ hợp đồng FROLL Token

let provider, signer, userAddress;
let frollSocialContract, frollTokenContract, frollSocialReadOnly;
let isRegistered = false;

const frollTokenAbi = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const frollSocialAbi = [
  "function isRegistered(address) view returns (bool)",
  "function register(string name, string bio, string avatar, string website) external",
  "function createPost(string content) external returns (uint256 id)",
  "function likePost(uint256 postId) external",
  "function commentOnPost(uint256 postId, string message) external",
  "function sharePost(uint256 postId) external",
  "function viewPost(uint256 postId) external",
  "function follow(address) external",
  "function unfollow(address) external",
  "function getUserPosts(address) view returns (uint256[])",
  "function posts(uint256) view returns (address, string, uint64, uint256)",
  "function getComments(uint256) view returns (tuple(address, string, uint256)[])",
  "function nextPostId() view returns (uint256)",
  "function likeCount(uint256) view returns (uint256)",
  "function shareCount(uint256) view returns (uint256)",
  "function getFollowers(address) view returns (address[])",
  "function getFollowing(address) view returns (address[])"
];

window.onload = async () => {
  if (window.ethereum) {
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer = provider.getSigner();
    frollSocialReadOnly = new ethers.Contract(frollSocialAddress, frollSocialAbi, provider);
    await tryAutoConnect();
  } else {
    provider = new ethers.providers.JsonRpcProvider("https://rpc.viction.xyz");
    frollSocialReadOnly = new ethers.Contract(frollSocialAddress, frollSocialAbi, provider);
    showHome(true); // vẫn cho xem bài khi chưa có ví
  }
};

// 👉 Kết nối ví
async function connectWallet() {
  try {
    await provider.send("eth_requestAccounts", []); 
    signer = provider.getSigner();
    userAddress = await signer.getAddress();
    await setupContracts();
    await updateUI();
  } catch (error) {
    console.error("Error connecting wallet:", error);
  }
}

// 👉 Ngắt kết nối ví
function disconnectWallet() {
  userAddress = null;
  isRegistered = false;
  document.getElementById("walletAddress").innerText = "Not connected";
  document.getElementById("connectBtn").style.display = "inline-block";
  document.getElementById("disconnectBtn").style.display = "none";
  document.getElementById("mainNav").style.display = "none";
  document.getElementById("mainContent").innerHTML = `<p class="tip">Tip: Use VIC chain in MetaMask. On mobile, open in the wallet's browser (e.g. Viction, MetaMask).</p>`;
}

// 👉 Gọi hợp đồng khi đã kết nối
async function setupContracts() {
  frollSocialContract = new ethers.Contract(frollSocialAddress, frollSocialAbi, signer);
  frollTokenContract = new ethers.Contract(frollTokenAddress, frollTokenAbi, signer);
}

// 👉 Tự kết nối lại nếu đã từng kết nối
async function tryAutoConnect() {
  const accounts = await provider.send("eth_accounts", []);
  if (accounts.length > 0) {
    userAddress = accounts[0];
    signer = provider.getSigner();
    await setupContracts();
    await updateUI();
  } else {
    showHome(true);
  }
}

// 👉 Hiển thị số dư ví và cập nhật menu
async function updateUI() {
  const frollBal = await frollTokenContract.balanceOf(userAddress);
  const vicBal = await provider.getBalance(userAddress);
  const froll = parseFloat(ethers.utils.formatEther(frollBal)).toFixed(2);
  const vic = parseFloat(ethers.utils.formatEther(vicBal)).toFixed(4);

  document.getElementById("walletAddress").innerHTML = `
    <span style="font-family: monospace;">${userAddress}</span>
    <button onclick="copyToClipboard('${userAddress}')" title="Copy address">📋</button>
    <span style="margin-left: 10px;">| ${froll} FROLL | ${vic} VIC</span>
  `;

  document.getElementById("connectBtn").style.display = "none";
  document.getElementById("disconnectBtn").style.display = "inline-block";
  isRegistered = await frollSocialContract.isRegistered(userAddress);
  updateMenu();
}

// 👉 Nút copy ví
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert("Address copied to clipboard!");
  });
}

// 👉 Hiển thị menu điều hướng
function updateMenu() {
  const nav = document.getElementById("mainNav");
  nav.style.display = "flex";
  if (isRegistered) {
    nav.innerHTML = `
      <button class="nav-btn" onclick="showHome(true)">🏠 Home</button>
      <button class="nav-btn" onclick="showProfile()">👤 My Profile</button>
      <button class="nav-btn" onclick="showNewPost()">✍️ New Post</button>
    `;
  } else {
    nav.innerHTML = `
      <button class="nav-btn" onclick="showHome(true)">🏠 Home</button>
      <button class="nav-btn" onclick="showRegister()">📝 Register</button>
    `;
  }
}

// 👉 Hiển thị bài viết mới nhất
async function showHome(reset = false) {
  if (reset) {
    document.getElementById("mainContent").innerHTML = `<h2>Latest Posts</h2>`;
  }

  let html = "";
  try {
    const next = await frollSocialReadOnly.nextPostId();
    const posts = await frollSocialReadOnly.posts(next.toNumber() - 1);
    
    for (const post of posts) {
      html += `
        <div class="post">
          <h3>${post[1]}</h3>
          <p>${post[2]}</p>
          <div class="actions">
            <button onclick="likePost(${post[0]})">👍 Like</button>
            <button onclick="commentOnPost(${post[0]})">💬 Comment</button>
            <button onclick="sharePost(${post[0]})">🔁 Share</button>
            <button onclick="viewProfile('${post[0]}')">👤 Profile</button>
            <button onclick="translatePost('${post[2]}')">🌐 Translate</button>
          </div>
        </div>
      `;
    }
  } catch (e) {
    console.error("Error loading posts:", e);
  }

  document.getElementById("mainContent").innerHTML += html;
}

// 👉 Tạo bài viết
async function createPost() {
  const content = document.getElementById("postContent").value.trim();
  if (content.length > 20000) {
    alert("Post content exceeds 20,000 characters.");
    return;
  }

  const tx = await frollSocialContract.createPost(content);
  await tx.wait();
  alert("Post created!");
  showHome(true);
}

// 👉 Like bài viết
async function likePost(postId) {
  try {
    const tx = await frollSocialContract.likePost(postId);
    await tx.wait();
    alert("Liked!");
  } catch (err) {
    alert("Failed to like.");
    console.error(err);
  }
}

// 👉 Comment bài viết
async function commentOnPost(postId) {
  const message = prompt("Enter your comment:");
  if (message) {
    try {
      const tx = await frollSocialContract.commentOnPost(postId, message);
      await tx.wait();
      alert("Comment added!");
    } catch (err) {
      alert("Failed to comment.");
      console.error(err);
    }
  }
}

// 👉 Share bài viết
async function sharePost(postId) {
  try {
    const tx = await frollSocialContract.sharePost(postId);
    await tx.wait();
    alert("Post shared!");
  } catch (err) {
    alert("Share failed.");
    console.error(err);
  }
}

// 👉 Dịch bài viết qua Google Translate
function translatePost(content) {
  const url = `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(content)}&op=translate`;
  window.open(url, "_blank");
}

// 👉 Hiển thị hồ sơ người dùng
async function viewProfile(addr) {
  const user = await frollSocialReadOnly.users(addr);
  document.getElementById("mainContent").innerHTML = `
    <h2>${user[0]}'s Profile</h2>
    <p>Bio: ${user[1]}</p>
    <p>Website: <a href="${user[3]}">${user[3]}</a></p>
  `;
}

// 👉 Hiển thị form đăng ký
function showRegister() {
  document.getElementById("mainContent").innerHTML = `
    <h2>Register Account</h2>
    <form onsubmit="registerUser(); return false;">
      <label>Name*</label>
      <input type="text" id="regName" required />
      <label>Bio</label>
      <input type="text" id="regBio" />
      <label>Avatar URL</label>
      <input type="text" id="regAvatar" />
      <label>Website</label>
      <input type="text" id="regWebsite" />
      <button type="submit">Register (0.001 FROLL)</button>
    </form>
  `;
}

// 👉 Gửi yêu cầu đăng ký tài khoản
async function registerUser() {
  const name = document.getElementById("regName").value.trim();
  const bio = document.getElementById("regBio").value.trim();
  const avatar = document.getElementById("regAvatar").value.trim();
  const website = document.getElementById("regWebsite").value.trim();
  const fee = ethers.utils.parseEther("0.001"); // Phí đăng ký = 0.001 FROLL

  try {
    const approveTx = await frollTokenContract.approve(frollSocialAddress, fee);
    await approveTx.wait();
    const tx = await frollSocialContract.register(name, bio, avatar, website);
    await tx.wait();
    alert("Registration successful!");
    await updateUI();
  } catch (err) {
    alert("Registration failed.");
    console.error(err);
  }
}
