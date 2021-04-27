const Controller = artifacts.require("Contoller");
const Storage = artifacts.require("Storage");
const Strategy = artifacts.require("AlphaStrategy");

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

async function makeVault(...args) {
  const vault = await Vault.new(...args);
  return vault;
};

async function setupCoreProtocol(underlying, governance) {
  // create controller contract
  const controller = await Controller.new();
  // create storage contract
  const storage = await Storage.new();

  // deploy vault contract
  vault = await makeVault(storage.address, underlying, {from: governance});
  console.log("Vault deployed: ", vault.address);

  // deploy strategy
  const strategy = await Strategy.new(vault.address, storage.address, {from: governance});
  console.log("Strategy Deployed: ", strategy.address);

  // set strategy to controller
  await controller.addVaultAndStrategy(vault.address, strategy.address);

  return {
    controller,
    vault,
    strategy
  };
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