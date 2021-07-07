const Controller = artifacts.require("Controller");
const Storage = artifacts.require("Storage");
const Strategy = artifacts.require("Strategy");
const Vault = artifacts.require("OnxAlphaVault");
const VaultProxy = artifacts.require("VaultProxy");
const IController = artifacts.require("IController");
const TAlphaToken = artifacts.require("TAlphaToken");

async function impersonates(targetAccounts){
  console.log("Impersonating...");
  for(i = 0; i < targetAccounts.length ; i++){
    console.log(targetAccounts[i]);
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [
        targetAccounts[i]
      ]
    });
  }
}

async function makeVault(implementationAddress, ...args) {
  const fromParameter = args[args.length - 1]; // corresponds to {from: governance}
  const vaultAsProxy = await VaultProxy.new(implementationAddress, fromParameter);
  const vault = await Vault.at(vaultAsProxy.address);
  await vault.initializeVault(...args);
  return vault;
};

async function setupCoreProtocol(underlying, governance) {
  // create storage contract
  const storageNew = await Storage.new({from: governance});
  // create controller contract
  const controllerNew = await Controller.new(storageNew.address, {from: governance});
  await storageNew.setController(controllerNew.address, {from: governance});
  const vaultNew = await Vault.new({from: governance});

  // deploy vault contract
  vault = await makeVault(vaultNew.address, storageNew.address, underlying.address, {from: governance});
  console.log("Vault deployed: ", vault.address);

  // deploy tAlpha token
  const tAlpha = await TAlphaToken.new({from: governance});

  // deploy strategy
  const strategy = await Strategy.new({from: governance});
  await strategy.initializeStrategy(
    storageNew.address,
    vault.address,
    tAlpha.address,
    { from: governance }
  );
  console.log("Strategy Deployed: ", strategy.address);
  await vault.setStrategy(strategy.address, { from: governance });

  tAlpha.setMinter(strategy.address, {from: governance});

  console.log("tAlpha Minter: ", await tAlpha.minter());

  const controller = await IController.at(controllerNew.address);
  // set strategy to controller
  await controller.addVaultAndStrategy(vault.address, strategy.address);

  return [
    controller,
    vault,
    strategy
  ];
}

async function depositVault(_farmer, _underlying, _vault, _amount) {
  await _underlying.approve(_vault.address, _amount, {from: _farmer});
  await _vault.deposit(_amount, {from: _farmer});
}

module.exports = {
  impersonates,
  setupCoreProtocol,
  depositVault,
};