/* FrollDice V2 frontend (ethers v5) — single-shot tx (high gas), bowl shaking + 4 coins
   Network: Viction (chainId 88), Token: FROLL (18 decimals)
   Contract V2: 0xf11f682F0c99D8001Ef8eB2C489B081884c6a6F9

   LƯU Ý:
   - Thông báo cho người chơi: TIẾNG ANH
   - Ghi chú trong code: TIẾNG VIỆT
*/

const CHAIN_ID_HEX = "0x58";
const RPC_URL = "https://rpc.viction.xyz";
const EXPLORER = "https://vicscan.xyz";

// Địa chỉ cố định
const FROLL_ADDR = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";
const DICE_ADDR  = "0xf11f682F0c99D8001Ef8eB2C489B081884c6a6F9";

/* ================== GAS POLICY (tối ưu “ký 1 lần là chạy”) ==================
   - Ưu tiên EIP-1559 nếu chain hỗ trợ: đặt maxFee cao + priority cao
   - Nếu không hỗ trợ, rơi về gasPrice legacy cao
   - gasLimit: ước lượng + đệm 20% (tối thiểu đủ rộng)
*/
const MIN_PRIORITY_GWEI = 3;   // priority fee tối thiểu
const MIN_MAXFEE_GWEI   = 12;  // maxFeePerGas tối thiểu
const MIN_GASPRICE_GWEI = 8;   // fallback legacy gasPrice tối thiểu

const LIMITS = {
  PLAY_MIN: 120000,  // tối thiểu gasLimit cho play
  PLAY_CAP: 250000,  // trần an toàn
  APPROVE:  80000,
  SETTABLE: 120000,
};

/* ABI gọn */
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)"
];
const DICE_ABI = [
  "function selectTable(uint256 _minBet) external",
  "function playerTable(address) view returns (uint256 minBet, uint256 maxBet)",
  "function bankroll() view returns (uint256)",
  "function play(uint256 amount, bool guessEven) external",
  "event Played(address indexed player, uint256 amount, bool guessEven, bool resultEven, bool win)"
];

/* ------- STATE ------- */
let provider, signer, account;
let froll, dice;
let frollDecimals = 18;

let lastBetAmountWei = null;
let lastGuessEven = true;

/* ------- HELPERS ------- */
const $ = (id) => document.getElementById(id);
const fmt   = (bn, d = 18) => ethers.utils.formatUnits(bn ?? 0, d).toString();
const parse = (val, d = 18) => ethers.utils.parseUnits(String(val || "0"), d);
const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "—");

function setStatus(msg, ok = null) {
  const el = $("tx-status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.remove("ok", "err");
  if (ok === true) el.classList.add("ok");
  if (ok === false) el.classList.add("err");
}

/* Rung bát — khớp CSS: .bowl.shake { animation: ... } */
function startShake() { try { $("bowl")?.classList.add("shake"); } catch {} }
function stopShake(delay = 800) { try { setTimeout(() => $("bowl")?.classList.remove("shake"), delay); } catch {} }

/* Vẽ 4 bóng đỏ/trắng theo parity (Even=0/2/4 đỏ; Odd=1/3 đỏ) */
function renderCoins({ parityEven, txHash }) {
  const coinsEl = $("coins");
  if (!coinsEl) return;

  coinsEl.className = "coins";
  coinsEl.innerHTML = "";

  function variant(m){ try{ return parseInt((txHash || "").slice(-4), 16) % m; } catch{ return 0; } }

  if (parityEven) {
    const layouts = ["layout-even-0", "layout-even-2a", "layout-even-4"];
    const cls = layouts[variant(layouts.length)];
    coinsEl.classList.add(cls);
    const redCount = { "layout-even-0": 0, "layout-even-2a": 2, "layout-even-4": 4 }[cls];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement("div");
      c.className = "coin " + (i < redCount ? "red" : "white");
      coinsEl.appendChild(c);
    }
  } else {
    const layouts = ["layout-odd-1", "layout-odd-3a"];
    const cls = layouts[variant(layouts.length)];
    coinsEl.classList.add(cls);
    const redCount = { "layout-odd-1": 1, "layout-odd-3a": 3 }[cls];
    for (let i = 0; i < 4; i++) {
      const c = document.createElement("div");
      c.className = "coin " + (i < redCount ? "red" : "white");
      coinsEl.appendChild(c);
    }
  }
}

/* Hiển thị kết quả + liên kết tx */
function showResult({ resultEven, win, txHash }) {
  const out = $("last-outcome"), pay = $("last-payout"), ltx = $("last-tx");
  if (out) out.textContent = resultEven == null ? "—" : resultEven ? "Even" : "Odd";
  if (pay) pay.textContent = win == null ? "—" : (win ? "WIN 🎉" : "LOSE");
  if (ltx) {
    ltx.textContent = txHash || "—";
    ltx.title = txHash || "";
    ltx.style.cursor = txHash ? "pointer" : "default";
    ltx.onclick = txHash ? () => window.open(`${EXPLORER}/tx/${txHash}`, "_blank") : null;
  }
  if (resultEven != null) renderCoins({ parityEven: !!resultEven, txHash });
}

/* Gọn lỗi cho user */
function prettifyError(e) {
  const raw = e?.error?.message || e?.data?.message || e?.reason || e?.message || String(e);
  if (/ALLOWANCE INSUFFICIENT/i.test(raw)) return "Allowance too low. Please approve first.";
  if (/PLEASE SELECT TABLE FIRST/i.test(raw)) return "No table selected. Please set your table first.";
  if (/BET BELOW MIN/i.test(raw)) return "Bet below table minimum.";
  if (/BET ABOVE MAX/i.test(raw)) return "Bet above table maximum.";
  if (/POOL INSUFFICIENT/i.test(raw)) return "Pool is insufficient for payout. Try a smaller amount.";
  if (/TRANSFER IN FAILED/i.test(raw)) return "Token transfer failed. Check your FROLL balance and allowance.";
  if (/PAYOUT FAILED/i.test(raw)) return "Payout failed. Please try again.";
  if (/user rejected/i.test(raw)) return "Transaction rejected by user.";
  if (/revert|reverted|CALL_EXCEPTION/i.test(raw)) return "Transaction reverted on-chain.";
  return raw;
}

/* ======= FEE OVERRIDES =======
   - Thử EIP-1559; nếu không có, fallback gasPrice legacy
   - Với play: ước lượng gas + đệm 20% (min/max)
*/
async function buildOverridesForPlay(argsForEstimate) {
  let gasLimit = ethers.BigNumber.from(LIMITS.PLAY_MIN.toString());
  try {
    const est = await dice.estimateGas.play(...argsForEstimate);
    // est * 1.2, clamp [PLAY_MIN, PLAY_CAP]
    gasLimit = est.mul(ethers.BigNumber.from(120)).div(100);
    const min = ethers.BigNumber.from(LIMITS.PLAY_MIN.toString());
    const cap = ethers.BigNumber.from(LIMITS.PLAY_CAP.toString());
    if (gasLimit.lt(min)) gasLimit = min;
    if (gasLimit.gt(cap)) gasLimit = cap;
  } catch {
    // nếu ước lượng lỗi, dùng mặc định rộng
    gasLimit = ethers.BigNumber.from(LIMITS.PLAY_CAP.toString());
  }

  // EIP-1559?
  const fee = await provider.getFeeData();
  const minPrio = ethers.utils.parseUnits(String(MIN_PRIORITY_GWEI), "gwei");
  const minMax  = ethers.utils.parseUnits(String(MIN_MAXFEE_GWEI), "gwei");

  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    // maxFee ≈ baseFee*2 + priority; đảm bảo >= minMax
    let prio = fee.maxPriorityFeePerGas.gte(minPrio) ? fee.maxPriorityFeePerGas : minPrio;
    let maxFee = fee.maxFeePerGas.mul(2).add(prio);
    if (maxFee.lt(minMax)) maxFee = minMax;
    return { gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
  } else {
    // legacy
    let gp = fee.gasPrice && fee.gasPrice.gte(ethers.utils.parseUnits(String(MIN_GASPRICE_GWEI), "gwei"))
      ? fee.gasPrice
      : ethers.utils.parseUnits(String(MIN_GASPRICE_GWEI), "gwei");
    return { gasLimit, gasPrice: gp };
  }
}

async function buildOverridesSimple(kind = "approve_or_set") {
  const fee = await provider.getFeeData();
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    const prio = ethers.utils.parseUnits(String(MIN_PRIORITY_GWEI), "gwei");
    let maxFee = fee.maxFeePerGas.mul(2).add(prio);
    const minMax = ethers.utils.parseUnits(String(MIN_MAXFEE_GWEI), "gwei");
    if (maxFee.lt(minMax)) maxFee = minMax;

    const gasLimit = ethers.BigNumber.from(
      kind === "set" ? LIMITS.SETTABLE : LIMITS.APPROVE
    );
    return { gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: prio };
  } else {
    const gasLimit = ethers.BigNumber.from(
      kind === "set" ? LIMITS.SETTABLE : LIMITS.APPROVE
    );
    const gp = ethers.utils.parseUnits(String(MIN_GASPRICE_GWEI), "gwei");
    return { gasLimit, gasPrice: gp };
  }
}

/* ------- WALLET ------- */
async function ensureChain() {
  if (!window.ethereum) throw new Error("Please install MetaMask or another EVM wallet.");
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current !== CHAIN_ID_HEX) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch (e) {
      if (e && e.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_ID_HEX,
            chainName: "Viction",
            nativeCurrency: { name: "VIC", symbol: "VIC", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER],
          }],
        });
      } else {
        throw e;
      }
    }
  }
}

async function connect() {
  setStatus("Connecting wallet…");
  await ensureChain();

  provider = new ethers.providers.Web3Provider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = provider.getSigner();
  account = await signer.getAddress();

  froll = new ethers.Contract(FROLL_ADDR, ERC20_ABI, signer);
  dice  = new ethers.Contract(DICE_ADDR,  DICE_ABI,  signer);
  try { frollDecimals = await froll.decimals(); } catch {}

  $("addr-short").textContent = short(account);
  $("wallet-info").classList.remove("hidden");
  $("btn-connect").classList.add("hidden");

  wireEvents();
  await refreshAll();
  setStatus("Wallet connected ✔", true);
}

function disconnect() {
  provider = signer = froll = dice = null;
  account = null;
  $("addr-short").textContent = "—";
  $("wallet-info").classList.add("hidden");
  $("btn-connect").classList.remove("hidden");
  $("pool-balance").textContent  = "—";
  $("vic-balance").textContent   = "0.0000";
  $("froll-balance").textContent = "0.0000";
  $("current-table").textContent = "Not set";
  $("limit-min").textContent = "—";
  $("limit-max").textContent = "—";
  setStatus("");
}

/* ------- READ ------- */
async function refreshAll() {
  if (!provider || !signer) return;
  const me = await signer.getAddress();

  const vic  = await provider.getBalance(me);
  const fbal = await froll.balanceOf(me);
  const pool = await dice.bankroll();

  $("vic-balance").textContent   = Number(ethers.utils.formatEther(vic)).toFixed(4);
  $("froll-balance").textContent = Number(fmt(fbal, frollDecimals)).toFixed(4);
  $("pool-balance").textContent  = Number(fmt(pool, frollDecimals)).toFixed(3);

  const [min, max] = await dice.playerTable(me);
  if (min && !min.isZero()) {
    $("current-table").textContent = `${fmt(min, frollDecimals)} – ${fmt(max, frollDecimals)} FROLL`;
    $("limit-min").textContent = fmt(min, frollDecimals);
    $("limit-max").textContent = fmt(max, frollDecimals);
  }
}

/* ------- TABLE ------- */
async function setTable() {
  if (!dice) throw new Error("Connect wallet first.");
  const minStr = $("minBet").value;
  if (!minStr) throw new Error("Enter Min Bet (e.g., 0.001).");
  const minWei = parse(minStr, frollDecimals);

  setStatus("Setting table…");
  const [curMin] = await dice.playerTable(await signer.getAddress());
  if (!curMin.eq(minWei)) {
    const overrides = await buildOverridesSimple("set");
    const tx = await dice.selectTable(minWei, overrides);
    await tx.wait();
  }
  await refreshAll();
  setStatus("Table set ✔", true);
}

/* ------- APPROVE ------- */
async function approveFroll() {
  if (!froll || !dice) throw new Error("Connect wallet first.");
  const raw = $("approve-amount").value || "1000"; // mặc định 1000 FROLL
  const amountWei = parse(raw, frollDecimals);
  if (amountWei.lte(0)) throw new Error("Approve amount must be greater than 0.");

  setStatus(`Approving ${raw} FROLL…`);
  const overrides = await buildOverridesSimple("approve");
  const tx = await froll.approve(DICE_ADDR, amountWei, overrides);
  await tx.wait();
  setStatus(`Approved ${raw} FROLL ✔`, true);
}

/* ------- PLAY (single-shot) ------- */
function isEvenSelected() { return $("btn-even").classList.contains("active"); } // true=Even
function toggleSide(e) {
  const side = e.currentTarget.dataset.side;
  if (side === "even") {
    $("btn-even").classList.add("active");
    $("btn-odd").classList.remove("active");
  } else {
    $("btn-odd").classList.add("active");
    $("btn-even").classList.remove("active");
  }
}

/* Preflight mạnh: bắt lỗi hợp đồng trước khi ký */
async function preflight(amountWei, guessEven) {
  const me = await signer.getAddress();

  const bal = await froll.balanceOf(me);
  if (bal.lt(amountWei)) throw new Error(`Insufficient FROLL balance. You have ${fmt(bal, frollDecimals)} FROLL.`);

  const [min, max] = await dice.playerTable(me);
  if (min.isZero()) throw new Error("No table selected. Please set your table first.");
  if (amountWei.lt(min)) throw new Error(`Bet below minimum (${fmt(min, frollDecimals)} FROLL).`);
  if (amountWei.gt(max)) throw new Error(`Bet above maximum (${fmt(max, frollDecimals)} FROLL).`);

  const alw = await froll.allowance(me, DICE_ADDR);
  if (alw.lt(amountWei)) throw new Error("Allowance too low. Please approve first.");

  const bank = await dice.bankroll();
  if (bank.lt(amountWei.mul(2))) throw new Error("Pool is insufficient for payout. Try a smaller amount.");

  try {
    await dice.callStatic.play(amountWei, guessEven);
  } catch (e) {
    throw new Error(`Cannot place bet: ${prettifyError(e)}`);
  }
}

async function placeBet() {
  if (!dice) throw new Error("Connect wallet first.");
  const amountStr = $("bet-amount").value;
  if (!amountStr) throw new Error("Enter the FROLL amount you want to bet.");
  const amountWei = parse(amountStr, frollDecimals);
  if (amountWei.lte(0)) throw new Error("Bet amount must be greater than 0.");

  const guessEven = isEvenSelected();

  setStatus("Preflight checks…");
  await preflight(amountWei, guessEven);

  // Rung bát & gửi đúng 1 lần với gas cao + gasLimit có đệm
  startShake();
  try {
    const overrides = await buildOverridesForPlay([amountWei, guessEven]);
    setStatus("Sending transaction…");
    const tx = await dice.play(amountWei, guessEven, overrides);
    $("last-tx").textContent = tx.hash;
    lastBetAmountWei = amountWei;
    lastGuessEven = guessEven;

    const rc = await tx.wait();
    if (!rc || rc.status !== 1) throw new Error("Transaction reverted on-chain.");

    await refreshAll();

    // Đọc event để hiện kết quả + vẽ bóng
    let resultEven = null, win = null;
    try {
      const iface = new ethers.utils.Interface(DICE_ABI);
      for (const lg of rc.logs || []) {
        if (lg.address.toLowerCase() === DICE_ADDR.toLowerCase()) {
          const parsed = iface.parseLog(lg);
          if (parsed && parsed.name === "Played" && parsed.args.player.toLowerCase() === (account || "").toLowerCase()) {
            resultEven = parsed.args.resultEven;
            win = parsed.args.win;
            break;
          }
        }
      }
    } catch {}

    showResult({ resultEven, win, txHash: rc.transactionHash });
    setStatus("Bet completed ✔", true);
  } catch (e) {
    setStatus(prettifyError(e), false);
  } finally {
    stopShake();
  }
}

/* ------- AMOUNT UTILS ------- */
function clearAmount(){ $("bet-amount").value = ""; }
function halfAmount(){ const v = Number($("bet-amount").value || 0); if (v > 0) $("bet-amount").value = Math.max(v/2, 0.001).toFixed(3); }
function doubleAmount(){ const v = Number($("bet-amount").value || 0); if (v > 0) $("bet-amount").value = (v*2).toFixed(3); }
function repeatAmount(){
  if (!lastBetAmountWei) return;
  $("bet-amount").value = fmt(lastBetAmountWei, frollDecimals);
  if (lastGuessEven) { $("btn-even").classList.add("active"); $("btn-odd").classList.remove("active"); }
  else { $("btn-odd").classList.add("active"); $("btn-even").classList.remove("active"); }
}

/* ------- EVENTS & INIT ------- */
function wireEvents() {
  $("btn-even")?.addEventListener("click", toggleSide);
  $("btn-odd")?.addEventListener("click", toggleSide);

  $("btn-set-table")?.addEventListener("click", async () => { try { await setTable(); } catch (e) { setStatus(e.message, false); } });
  $("btn-approve")?.addEventListener("click", async () => { try { await approveFroll(); await refreshAll(); } catch (e) { setStatus(e.message, false); } });
  $("btn-play")?.addEventListener("click", async () => { try { await placeBet(); } catch (e) { setStatus(e.message, false); } });

  $("btn-clear")?.addEventListener("click", clearAmount);
  $("btn-half")?.addEventListener("click", halfAmount);
  $("btn-double")?.addEventListener("click", doubleAmount);
  $("btn-repeat")?.addEventListener("click", repeatAmount);

  if (window.ethereum) {
    window.ethereum.on("chainChanged", () => window.location.reload());
    window.ethereum.on("accountsChanged", () => window.location.reload());
  }
}

/* Expose cho index.html */
window.connectWallet = async () => { try { await connect(); } catch (e) { setStatus(e.message, false); } };
window.disconnectWallet = () => disconnect();

/* Khi mở trang: đọc pool + hiển thị ván gần nhất (để thấy bóng ngay) */
async function showLatestOnLoad() {
  try {
    const ro = new ethers.providers.JsonRpcProvider(RPC_URL);
    const rdice = new ethers.Contract(DICE_ADDR, DICE_ABI, ro);
    const pool = await rdice.bankroll();
    $("pool-balance").textContent = Number(fmt(pool, 18)).toFixed(3);

    const current = await ro.getBlockNumber();
    const iface = new ethers.utils.Interface(DICE_ABI);
    const topic0 = iface.getEventTopic("Played");
    const logs = await ro.getLogs({
      address: DICE_ADDR,
      fromBlock: Math.max(current - 5000, 0),
      toBlock: current,
      topics: [topic0],
    });
    if (logs.length) {
      const last = logs[logs.length - 1];
      const parsed = iface.parseLog(last);
      showResult({ resultEven: parsed.args.resultEven, win: null, txHash: last.transactionHash });
    }
  } catch {}
}

/* Bootstrap */
document.addEventListener("DOMContentLoaded", () => {
  $("btn-connect")?.addEventListener("click", () => window.connectWallet && window.connectWallet());
  $("btn-disconnect")?.addEventListener("click", () => window.disconnectWallet && window.disconnectWallet());
  showLatestOnLoad();
  setStatus("Ready.");
});
