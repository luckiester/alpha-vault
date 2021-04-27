const Utils = require("./utils");
const { impersonates, setupCoreProtocol, depositVault } = require("./utils/fork-utils.js");

const { send } = require("@openzeppelin/test-helpers");
const BigNumber = require("bignumber.js");
const IERC20 = artifacts.require("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20");
const IStakingPool = artifacts.require("IStakingPool");

const wethstethLPAddress = "0x1C615074c281c5d88ACc6914D408d7E71Eb894EE";
const onxAddress = "0xe0ad1806fd3e7edf6ff52fdb822432e847411033";
const onxStakingPool =  "0x569C1E3e128893431449D2c6C0dc156f33f49B68";

describe("Alpha strategy test", function() {
  let accounts;
  let underlying;

  let underlyingWhale = "0x9CE6E6B60C894d1DF9BC3D9D6cC969b79FB176B7"; 

  let governance;
  let farmer1;

  let farmerBalance;

  let controller, vault, strategy;
  let onx;

  async function setupExternalContracts() {
    underlying = await IERC20.at(wethstethLPAddress);
    onx = await IERC20.at(onxAddress);
    console.log("Fetching Underlying at: ", underlying.address);
  }

  async function setupBalance() {
    let etherGiver = accounts[9];
    await send.ether(etherGiver, underlyingWhale, "1" + "000000000000000000");

    farmerBalance = await underlying.balanceOf(underlyingWhale);
    Utils.assertBNGt(farmerBalance, 0);
    await underlying.transfer(farmer1, farmerBalance, {from: underlyingWhale});
  }

  before(async function () {
    accounts = await web3.eth.getAccounts();
    governance = accounts[0];

    farmer1 = accounts[1];

    await impersonates([underlyingWhale]);

    await setupExternalContracts();

    [controller, vault, strategy] = await setupCoreProtocol(underlying, governance);

    await setupBalance();
  });

  describe("Strategy pass", function () {
    it("User earns money", async function () {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      console.log('farmerBalance: ', farmerBalance.toString());
      await depositVault(farmer1, underlying, vault, farmerBalance);

      let farmerVaultShare = new BigNumber(await vault.balanceOf(farmer1)).toFixed();
      console.log('farmerVaultShare: ', farmerVaultShare.toString());

      let hours = 10;

      for (let i = 0; i < hours; i++) {
        console.log("loop ", i);

        let blocksPerHour = 2400;
        await controller.stakeOnsenFarm({from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeSushiBar({from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeXSushiFarm({from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        await controller.stakeOnx({from: governance});
        await Utils.advanceNBlock(blocksPerHour);

        console.log("onx in staking pool: ", IStakingPool(onxStakingPool).earned(controller.address));
      }

      await vault.harvest({from: farmer1});
      await vault.withdraw({from: farmer1});

      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      let farmerOnxAmount = new BigNumber(await onx.balanceOf(farmer1));

      console.log("farmerOnxAmount: ", farmerOnxAmount.toFixed());
      console.log("farmerOldBalance: ", farmerOldBalance.toFixed());
      console.log("farmerNewBalance: ", farmerNewBalance.toFixed());
    })
  })
});