const { upgrades } = require("hardhat");

async function main() {

  const [deployer] = await ethers.getSigners();

  const wethRopsten = "0xb603cea165119701b58d56d10d2060fbfb3efad8";
  const stEthRopsten = "0x90b15ec7eaef2b0106a1f63c4ebb51572723d970";

  console.log(
    "Deploying contracts with the account:",
    deployer.address
  );
  
  console.log("Account balance:", (await deployer.getBalance()).toString());

  // External contracts
  // Deploy UniswapV2Pair contract
  const UniswapV2Pair = await ethers.getContractFactory("UniswapV2Pair");
  const uniswapV2Pair = await UniswapV2Pair.deploy();

  console.log("UniswapV2Pair address:", uniswapV2Pair.address);

  // Initialize UniswapV2Pair
  await uniswapV2Pair.initialize(wethRopsten, stEthRopsten);

  // Create Storage Contract
  const Storage = await ethers.getContractFactory("Storage");
  const storage = await Storage.deploy();

  console.log("Storage address:", storage.address);

  // Create Controller Contract
  const Controller = await ethers.getContractFactory("Controller");
  const controller = await Controller.deploy(storage.address);

  console.log("Controller address:", controller.address);

  // Set controller address to storage
  await storage.setController(controller.address);

  // Deploy Vault Contract
  const Vault = await ethers.getContractFactory("OnxAlphaVault");
  const vaultNew = await Vault.deploy();

  console.log("New Vault address:", vaultNew.address);

  // Deploy VaultProxy Contract
  const VaultProxy = await ethers.getContractFactory("VaultProxy");
  const vaultProxy = await VaultProxy.deploy(vaultNew.address);
  // const vaultProxy = await upgrades.deployProxy(VaultProxy, [vaultNew.address]);
  await vaultProxy.deployed();

  console.log("VaultProxy address:", vaultProxy.address);

  // initialize vault
  const vault = await ethers.getContractAt(
    "OnxAlphaVault",
    vaultProxy.address
  );
  await vault.initializeVault(storage.address, uniswapV2Pair.address);

  // Deploy Strategy Contract
  const Strategy = await ethers.getContractFactory("Strategy");
  const strategy = await Strategy.deploy();

  console.log("Strategy address:", strategy.address);

  // initialize Strategy
  await strategy.initializeStrategy(storage.address, vaultProxy.address, {gasLimit: 250000});

  // set strategy to vault
  await vault.setStrategy(strategy.address, {gasLimit: 250000});

  // set vault and strategy to vault
  await controller.addVaultAndStrategy(vaultProxy.address, strategy.address, {gasLimit: 250000});
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });