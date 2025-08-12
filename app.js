const frollSocialAddress = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82"; // Địa chỉ hợp đồng FrollSocial
const frollTokenAddress = "0xB4d562A8f811CE7F134a1982992Bd153902290BC"; // Địa chỉ hợp đồng FROLL Token

let provider, signer, userAddress;
let frollSocialContract, frollTokenContract;
let isRegistered = false;

// 👉 Hàm kết nối ví MetaMask
async function connectWallet() {
  try {
    if (window.ethereum) {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      userAddress = await signer.getAddress();
      frollSocialContract = new ethers.Contract(frollSocialAddress, frollSocialAbi, signer);
      frollTokenContract = new ethers.Contract(frollTokenAddress, frollTokenAbi, signer);
      await updateUI();
    } else {
      alert('MetaMask is not installed');
    }
  } catch (error) {
    console.error('Error connecting wallet:', error);
  }
}

// 👉 Ngắt kết nối ví
function disconnectWallet() {
  userAddress = null;
  isRegistered = false;
  document.getElementById("walletAddress").innerText = "Not connected";
  document.getElementById("connectBtn").style.display = "inline-block";
  document.getElementById("disconnectBtn").style.display = "none";
}

// 👉 Cập nhật giao diện
async function updateUI() {
  const frollBal = await frollTokenContract.balanceOf(userAddress);
  const vicBal = await provider.getBalance(userAddress);
  const froll = parseFloat(ethers.utils.formatEther(frollBal)).toFixed(2);
  const vic = parseFloat(ethers.utils.formatEther(vicBal)).toFixed(4);
  document.getElementById("walletAddress").innerText = `Connected: ${userAddress}`;
  document.getElementById("frollBalance").innerText = `FROLL: ${froll}`;
  document.getElementById("vicBalance").innerText = `VIC: ${vic}`;
  isRegistered = await frollSocialContract.isRegistered(userAddress);
  updateMenu();
}

// 👉 Cập nhật menu
function updateMenu() {
  const nav = document.getElementById("mainNav");
  nav.style.display = "flex";
  if (isRegistered) {
    nav.innerHTML = `
      <button class="nav-btn" onclick="showHome()">🏠 Home</button>
      <button class="nav-btn" onclick="showProfile()">👤 My Profile</button>
      <button class="nav-btn" onclick="showNewPost()">✍️ New Post</button>
    `;
  } else {
    nav.innerHTML = `
      <button class="nav-btn" onclick="showHome()">🏠 Home</button>
      <button class="nav-btn" onclick="showRegister()">📝 Register</button>
    `;
  }
}

// 👉 Hàm tạo bài viết
async function createPost() {
  const content = document.getElementById("postContent").value.trim();
  const media = document.getElementById("postLink").value.trim();
  if (content.length === 0 || content.length > 20000) {
    alert("Content should not be empty or exceed 20,000 characters");
    return;
  }

  try {
    const tx = await frollSocialContract.createPost(content);
    await tx.wait();
    alert("Post created!");
    showHome();
  } catch (error) {
    console.error("Error creating post:", error);
  }
}

// 👉 Hàm đăng ký tài khoản
async function registerUser() {
  const name = document.getElementById("regName").value;
  const bio = document.getElementById("regBio").value;
  const avatar = document.getElementById("regAvatar").value;
  const website = document.getElementById("regWebsite").value;
  const fee = ethers.utils.parseEther("0.001");

  try {
    await frollTokenContract.approve(frollSocialAddress, fee);
    const tx = await frollSocialContract.register(name, bio, avatar, website);
    await tx.wait();
    alert("Registration successful!");
    updateUI();
  } catch (error) {
    console.error("Error registering:", error);
  }
}

// 👉 Chức năng hiển thị bài viết
async function showHome() {
  const posts = await frollSocialContract.getPosts();
  const postList = document.getElementById("postList");
  postList.innerHTML = "";
  posts.forEach(post => {
    postList.innerHTML += `
      <div class="post">
        <h3>${post.title}</h3>
        <p>${post.content}</p>
        <button onclick="likePost(${post.id})">👍 Like</button>
        <button onclick="sharePost(${post.id})">🔁 Share</button>
        <button onclick="viewProfile(${post.author})">👤 Profile</button>
        <button onclick="translatePost(${post.content})">🌐 Translate</button>
      </div>
    `;
  });
}

// 👉 Chức năng like bài viết
async function likePost(postId) {
  try {
    const tx = await frollSocialContract.likePost(postId);
    await tx.wait();
    alert("Liked!");
  } catch (error) {
    console.error("Error liking post:", error);
  }
}

// 👉 Chức năng chia sẻ bài viết
async function sharePost(postId) {
  try {
    const tx = await frollSocialContract.sharePost(postId);
    await tx.wait();
    alert("Post shared!");
  } catch (error) {
    console.error("Error sharing post:", error);
  }
}
