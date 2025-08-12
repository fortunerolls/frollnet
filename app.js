const frollSocialAddress = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82"; // Địa chỉ hợp đồng FrollSocial
const frollTokenAddress = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // Địa chỉ hợp đồng FROLL Token

let provider, signer, userAddress;
let frollSocialContract, frollTokenContract, frollSocialReadOnly;
let isRegistered = false;
let lastPostId = 0;
let seen = new Set();

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
  "function posts(uint256) view returns (address author, string content, uint256 timestamp, uint256 likes)",
  "function users(address) view returns (string name, string bio, string avatar, string website)",
  "function nextPostId() view returns (uint256)",
  "function likeCount(uint256) view returns (uint256)",
  "function shareCount(uint256) view returns (uint256)",
  "function viewCount(uint256) view returns (uint256)",
  "function getFollowers(address) view returns (address[])",
  "function getFollowing(address) view returns (address[])"
];

// 👉 Load giao diện khi mở trang
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
  await provider.send("eth_requestAccounts", []);  // Yêu cầu kết nối ví MetaMask
  signer = provider.getSigner();
  userAddress = await signer.getAddress();
  await setupContracts();
  await updateUI();
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
  showHome(true);
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
      <form onsubmit="searchByAddress(); return false;" style="margin-left: 10px;">
        <input type="text" id="searchInput" placeholder="Search wallet..." style="padding:4px; font-size:13px; border-radius:6px; border:1px solid #ccc;" />
        <button type="submit" style="padding:4px 8px; margin-left:5px; border-radius:6px; background:#007bff; color:white; border:none;">🔍</button>
      </form>
    `;
  } else {
    nav.innerHTML = `
      <button class="nav-btn" onclick="showHome(true)">🏠 Home</button>
      <button class="nav-btn" onclick="showRegister()">📝 Register</button>
    `;
  }
}

// 👉 Gán sự kiện kết nối / ngắt kết nối
document.getElementById("connectBtn").onclick = connectWallet;
document.getElementById("disconnectBtn").onclick = disconnectWallet;

// 👉 Hiển thị form đăng ký tài khoản
function showRegister() {
  document.getElementById("mainContent").innerHTML = `
    <h2>Register Account</h2>
    <form onsubmit="registerUser(); return false;">
      <label>Name*</label>
      <input type="text" id="regName" maxlength="160" required/>
      <label>Bio</label>
      <input type="text" id="regBio" maxlength="160"/>
      <label>Avatar URL</label>
      <input type="text" id="regAvatar"/>
      <label>Website</label>
      <input type="text" id="regWebsite"/>
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
    await approveTx.wait(); // Chờ xác nhận việc phê duyệt
    const tx = await frollSocialContract.register(name, bio, avatar, website);
    await tx.wait(); // Chờ xác nhận việc đăng ký tài khoản
    alert("Registration successful!");
    await updateUI();
  } catch (err) {
    alert("Registration failed.");
    console.error(err);
  }
}

// 👉 Tạo bài viết
async function createPost() {
  const content = document.getElementById("postContent").value.trim();

  if (content.length === 0) {
    alert("Post content cannot be empty.");
    return;
  }

  if (content.length > 20000) {
    alert("Post content exceeds the maximum length of 20,000 characters.");
    return;
  }

  try {
    const tx = await frollSocialContract.createPost(content);
    await tx.wait(); // Đợi giao dịch xác nhận
    alert("Post created!");
    await showHome(true); // Hiển thị lại các bài viết mới
  } catch (err) {
    alert("Post failed.");
    console.error(err);
  }
}

// 👉 Hiển thị bài viết mới nhất
async function showHome(reset = false) {
  if (reset) {
    lastPostId = 0;
    seen.clear();
    document.getElementById("mainContent").innerHTML = `<h2>Latest Posts</h2>`;
  }

  let html = "";
  if (lastPostId === 0) {
    try {
      const next = await frollSocialReadOnly.nextPostId();
      lastPostId = next.toNumber();
    } catch (e) {
      console.error("Cannot fetch nextPostId", e);
      return;
    }
  }

  let i = lastPostId - 1;
  let loaded = 0;

  while (i > 0 && loaded < 5) {
    if (seen.has(i)) {
      i--;
      continue;
    }

    try {
      const post = await frollSocialReadOnly.posts(i);
      if (post[0] === "0x0000000000000000000000000000000000000000" || post[4] === 0) {
        seen.add(i);
        i--;
        continue;
      }

      const key = `${post[1]}|${post[2]}|${post[4]}`;
      if (seen.has(key)) {
        i--;
        continue;
      }

      seen.add(i);
      seen.add(key);

      const fullAddress = post[0];
      const title = post[1];
      const content = post[2];
      const media = post[3];
      const time = new Date(post[4] * 1000).toLocaleString();

      const [likes, shares] = await Promise.all([frollSocialReadOnly.likeCount(i), frollSocialReadOnly.shareCount(i)]);

      html += `
        <div class="post">
          <div class="title">${title}</div>
          <div class="author">
            <span style="font-family: monospace;">${fullAddress}</span>
            <button onclick="copyToClipboard('${fullAddress}')" title="Copy" style="margin-left: 4px;">📋</button>
            • ${time}
          </div>
          <div class="content">${content}</div>
          ${media ? `<img src="${media}" alt="media"/>` : ""}
          <div class="metrics">❤️ ${likes} • 🔁 ${shares}</div>
          <div class="actions">
            ${isRegistered ? `
              <button onclick="likePost(${i})">👍 Like</button>
              <button onclick="showComments(${i})">💬 Comment</button>
              <button onclick="sharePost(${i})">🔁 Share</button>
            ` : ""}
            <button onclick="viewProfile('${post[0]}')">👤 Profile</button>
            <button onclick="translatePost(decodeURIComponent('${encodeURIComponent(content)}'))">🌐 Translate</button>
          </div>
          <div id="comments-${i}"></div>
        </div>
      `;
      loaded++;
    } catch (err) {
      console.warn("Failed loading post", i, err);
    }
    i--;
  }

  lastPostId = i + 1;
  document.getElementById("mainContent").innerHTML += html;

  if (lastPostId > 1) {
    document.getElementById("mainContent").innerHTML += `
      <div style="text-align:center; margin-top:10px;">
        <button onclick="showHome()">⬇️ Load More</button>
      </div>
    `;
  }
}

// 👉 Dịch bài viết qua Google Translate
function translatePost(text) {
  const url = `https://translate.google.com/?sl=auto&tl=en&text=${encodeURIComponent(text)}&op=translate`;
  window.open(url, "_blank");
}

