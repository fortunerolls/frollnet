const FROLL_ADDRESS = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const FROLLSOCIAL_ADDRESS = "0x8F7A9ca5c84A02acA6415Ec0367f64EFeB0C7f82";
const provider = new ethers.providers.Web3Provider(window.ethereum);
let signer, frollToken, frollSocial;

async function connectWallet() {
  try {
    await provider.send("eth_requestAccounts", []);
    signer = provider.getSigner();
    const walletAddress = await signer.getAddress();
    document.getElementById("walletAddress").innerText = walletAddress;
    
    frollToken = new ethers.Contract(FROLL_ADDRESS, FROLL_ABI, signer);
    frollSocial = new ethers.Contract(FROLLSOCIAL_ADDRESS, FrollSocial_ABI, signer);
    
    updateBalance();
  } catch (error) {
    console.error(error);
  }
}

async function updateBalance() {
  const address = await signer.getAddress();
  const frollBalance = await frollToken.balanceOf(address);
  const vicBalance = await provider.getBalance(address);

  document.getElementById("frollBalance").innerText = `FROLL: ${ethers.utils.formatUnits(frollBalance, 18)}`;
  document.getElementById("vicBalance").innerText = `VIC: ${ethers.utils.formatUnits(vicBalance, 18)}`;
}

document.getElementById("connectBtn").addEventListener("click", connectWallet);

// Hàm đăng ký tài khoản
async function registerAccount() {
  try {
    const registerFee = await frollSocial.registerFee();
    const tx = await frollSocial.register({ value: registerFee });
    await tx.wait();
    alert("Registration successful!");
  } catch (error) {
    console.error(error);
    alert("Registration failed.");
  }
}

// Hàm tạo bài đăng
async function createPost(content) {
  try {
    const tx = await frollSocial.createPost(content);
    await tx.wait();
    alert("Post created!");
    fetchPosts();  // Lấy lại danh sách bài viết sau khi tạo thành công
  } catch (error) {
    console.error(error);
    alert("Post creation failed.");
  }
}

// Hàm hiển thị các bài đăng từ hợp đồng
async function fetchPosts() {
  const postsSection = document.getElementById("postList");
  const totalPosts = await frollSocial.nextPostId();
  
  postsSection.innerHTML = '';  // Xóa các bài viết hiện tại
  
  for (let i = 1; i <= totalPosts; i++) {
    const post = await frollSocial.posts(i);
    const postElement = document.createElement('div');
    postElement.className = 'post';
    postElement.innerHTML = `
      <div class="title">${post.content}</div>
      <div class="author">Posted by: ${post.author}</div>
      <div class="metrics">Likes: ${post.likes}</div>
      <div class="actions">
        <button onclick="likePost(${post.id})">👍 Like</button>
        <button onclick="followPost(${post.id})">👤 Follow</button>
        <button onclick="sharePost(${post.id})">🔁 Share</button>
        <button onclick="commentPost(${post.id})">💬 Comment</button>
      </div>
    `;
    postsSection.appendChild(postElement);
  }
}

// Hàm Like bài viết
async function likePost(postId) {
  try {
    const tx = await frollSocial.likePost(postId);
    await tx.wait();
    alert("Post liked!");
    fetchPosts();  // Cập nhật lại danh sách bài viết sau khi like
  } catch (error) {
    console.error(error);
    alert("Failed to like post.");
  }
}

// Hàm Follow bài viết
async function followPost(postId) {
  try {
    const tx = await frollSocial.followPost(postId);
    await tx.wait();
    alert("Following post!");
    fetchPosts();  // Cập nhật lại danh sách bài viết sau khi follow
  } catch (error) {
    console.error(error);
    alert("Failed to follow post.");
  }
}

// Hàm Share bài viết
async function sharePost(postId) {
  const post = await frollSocial.posts(postId);
  const postUrl = `https://froll.net/post/${postId}`;
  navigator.clipboard.writeText(postUrl);
  alert("Post link copied to clipboard!");
}

// Hàm Comment bài viết
async function commentPost(postId) {
  const comment = prompt("Enter your comment:");
  if (comment) {
    alert(`Commented on Post #${postId}: ${comment}`);
    // Lưu bình luận vào backend sau
  }
}

// Lấy bài viết khi tải trang
window.onload = fetchPosts;
