// Sự kiện chạy khi trang đã tải hoàn tất
document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const connectWalletButton = document.getElementById('connect-wallet');
    const disconnectWalletButton = document.getElementById('disconnect-wallet');
    const walletAddressDisplay = document.getElementById('wallet-address');
    const fromAmountInput = document.getElementById('from-amount');
    const toAmountInput = document.getElementById('to-amount');
    const fromTokenInfo = document.getElementById('from-token-info');
    const toTokenInfo = document.getElementById('to-token-info');
    const fromTokenLogo = document.getElementById('from-token-logo');
    const toTokenLogo = document.getElementById('to-token-logo');
    const swapDirectionButton = document.getElementById('swap-direction');
    const maxButton = document.getElementById('max-button');
    const swapNowButton = document.getElementById('swap-now');
    const transactionFeeDisplay = document.getElementById('transaction-fee');
    const gasFeeDisplay = document.getElementById('gas-fee');

    const connectInterface = document.getElementById('connect-interface');
    const newContent = document.getElementById('new-content');
    const swapInterface = document.getElementById('swap-interface');

    // Blockchain Config
    let provider, signer;
    const frollSwapAddress = "0x9197BF0813e0727df4555E8cb43a0977F4a3A068";
    const frollTokenAddress = "0xB4d562A8f811CE7F134a1982992Bd153902290BC";

    const RATE = 100;
    const FEE = 0.01;
    const GAS_FEE_ESTIMATE = 0.000029;
    const MIN_SWAP_AMOUNT_VIC = 0.011;
    const MIN_SWAP_AMOUNT_FROLL = 0.00011;

    const frollSwapABI = [
        { "inputs": [], "name": "swapVicToFroll", "outputs": [], "stateMutability": "payable", "type": "function" },
        { "inputs": [{ "internalType": "uint256", "name": "frollAmount", "type": "uint256" }],
          "name": "swapFrollToVic", "outputs": [], "stateMutability": "nonpayable", "type": "function" }
    ];

    const frollABI = [
        { "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
          "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
          "stateMutability": "view", "type": "function" },
        { "inputs": [
            { "internalType": "address", "name": "spender", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }],
          "name": "approve", "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
          "stateMutability": "nonpayable", "type": "function" }
    ];

    let frollSwapContract, frollTokenContract;
    let walletAddress = null;
    let balances = { VIC: 0, FROLL: 0 };
    let fromToken = 'VIC';
    let toToken = 'FROLL';

    async function ensureWalletConnected() {
        try {
            if (!window.ethereum) {
                alert('MetaMask is not installed. Please install MetaMask to use this application.');
                return false;
            }

            await window.ethereum.request({ method: "eth_requestAccounts" });

            provider = new ethers.providers.Web3Provider(window.ethereum);
            signer = provider.getSigner();
            walletAddress = await signer.getAddress();

            return true;
        } catch (error) {
            console.error("Failed to connect wallet:", error);
            alert('Failed to connect wallet. Please try again.');
            return false;
        }
    }

    async function updateBalances() {
        try {
            balances.VIC = parseFloat(ethers.utils.formatEther(await provider.getBalance(walletAddress)));
            balances.FROLL = parseFloat(
                ethers.utils.formatUnits(await frollTokenContract.balanceOf(walletAddress), 18)
            );

            updateTokenDisplay();
        } catch (error) {
            console.error('Error fetching balances:', error);
        }
    }

    function updateTokenDisplay() {
        fromTokenInfo.textContent = `${fromToken}: ${balances[fromToken].toFixed(18)}`;
        toTokenInfo.textContent = `${toToken}: ${balances[toToken].toFixed(18)}`;
    }

    maxButton.addEventListener('click', async () => {
        const connected = await ensureWalletConnected();
        if (!connected) return;

        fromAmountInput.value = balances[fromToken];
        calculateToAmount();
    });

    fromAmountInput.addEventListener('input', calculateToAmount);
    function calculateToAmount() {
        const fromAmount = parseFloat(fromAmountInput.value);
        if (isNaN(fromAmount) || fromAmount <= 0) {
            toAmountInput.value = '';
            return;
        }

        let netFromAmount;
        let toAmount;

        if (fromToken === 'VIC') {
            if (fromAmount < MIN_SWAP_AMOUNT_VIC) {
                alert(`Minimum swap amount is ${MIN_SWAP_AMOUNT_VIC} VIC.`);
                return;
            }
            netFromAmount = fromAmount - FEE;
            toAmount = netFromAmount > 0 ? (netFromAmount / RATE).toFixed(18) : '0.000000000000000000';
        } else {
            if (fromAmount < MIN_SWAP_AMOUNT_FROLL) {
                alert(`Minimum swap amount is ${MIN_SWAP_AMOUNT_FROLL} FROLL.`);
                return;
            }
            netFromAmount = fromAmount * RATE;
            toAmount = netFromAmount > FEE ? (netFromAmount - FEE).toFixed(18) : '0.000000000000000000';
        }

        toAmountInput.value = toAmount;
        transactionFeeDisplay.textContent = `Transaction Fee: ${FEE} VIC`;
        gasFeeDisplay.textContent = `Estimated Gas Fee: ~${GAS_FEE_ESTIMATE} VIC`;
    }

    swapDirectionButton.addEventListener('click', () => {
        [fromToken, toToken] = [toToken, fromToken];
        [fromTokenLogo.src, toTokenLogo.src] = [toTokenLogo.src, fromTokenLogo.src];
        updateTokenDisplay();
        clearInputs();
    });

    function clearInputs() {
        fromAmountInput.value = '';
        toAmountInput.value = '';
    }

    swapNowButton.addEventListener('click', async () => {
        try {
            const fromAmount = parseFloat(fromAmountInput.value);

            if (isNaN(fromAmount) || fromAmount <= 0) {
                alert('Please enter a valid amount to swap.');
                return;
            }

            if (fromToken === 'VIC') {
                const fromAmountInWei = ethers.utils.parseEther(fromAmount.toString());
                const tx = await frollSwapContract.swapVicToFroll({ value: fromAmountInWei });
                await tx.wait();
                alert('Swap VIC to FROLL successful.');
            } else {
                const fromAmountInWei = ethers.utils.parseUnits(fromAmount.toString(), 18);
                const approveTx = await frollTokenContract.approve(frollSwapAddress, fromAmountInWei);
                await approveTx.wait();
                const tx = await frollSwapContract.swapFrollToVic(fromAmountInWei);
                await tx.wait();
                alert('Swap FROLL to VIC successful.');
            }

            await updateBalances();
        } catch (error) {
            console.error("Swap failed:", error);
            alert(`Swap failed: ${error.reason || error.message}`);
        }
    });

    connectWalletButton.addEventListener('click', async () => {
        const connected = await ensureWalletConnected();
        if (!connected) return;

        try {
            frollSwapContract = new ethers.Contract(frollSwapAddress, frollSwapABI, signer);
            frollTokenContract = new ethers.Contract(frollTokenAddress, frollABI, signer);

            walletAddressDisplay.textContent = walletAddress;
            await updateBalances();
            showSwapInterface();
        } catch (error) {
            console.error('Failed to initialize wallet:', error);
            alert(`Failed to initialize wallet: ${error.message}`);
        }
    });

    disconnectWalletButton.addEventListener('click', () => {
        walletAddress = null;
        balances = { VIC: 0, FROLL: 0 };
        frollSwapContract = null;
        frollTokenContract = null;

        walletAddressDisplay.textContent = '';
        clearInputs();
        showConnectInterface();
        alert('Wallet disconnected successfully.');
    });

    function showSwapInterface() {
        swapInterface.style.display = 'block';
        connectInterface.style.display = 'none';
        newContent.style.display = 'none';
    }

    function showConnectInterface() {
        swapInterface.style.display = 'none';
        connectInterface.style.display = 'block';
        newContent.style.display = 'block';
    }

    async function updateFrollPrice() {
        try {
            const response = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=VICUSDT");
            const data = await response.json();
            const vicPrice = parseFloat(data.price);
            const frollPrice = (vicPrice * 100).toFixed(2);
            document.getElementById("froll-price").textContent = `1 FROLL = ${frollPrice} USD`;
        } catch (error) {
            console.error("Lỗi khi lấy giá VIC:", error);
            document.getElementById("froll-price").textContent = "Price unavailable";
        }
    }

    setInterval(updateFrollPrice, 10000);
    updateFrollPrice();

    showConnectInterface();
});

function copyToClipboard() {
    const contractAddress = document.getElementById("contract-address").textContent;
    navigator.clipboard.writeText(contractAddress).then(() => {
        alert("✅ Copied to clipboard: " + contractAddress);
    }).catch(err => {
        console.error("Copy failed!", err);
    });
}
