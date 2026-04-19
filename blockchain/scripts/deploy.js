const hre = require("hardhat");
const fs = require("fs");

async function main() {
  const RentalContract = await hre.ethers.getContractFactory("RentalContract");
  const DisputesContract = await hre.ethers.getContractFactory(
    "DisputesContract",
  );

  const rentalContract = await RentalContract.deploy();
  const disputesContract = await DisputesContract.deploy();

  await rentalContract.waitForDeployment(); // ethers v6 way
  await disputesContract.waitForDeployment();

  const rentalContractAddress = await rentalContract.getAddress();
  const disputesContractAddress = await disputesContract.getAddress();

  console.log("RentalContract deployed to:", rentalContractAddress);
  console.log("DisputesContract deployed to:", disputesContractAddress);

  const contractAddresses = {
    rentalContractAddress,
    disputesContractAddress,
  };

  const addressesJson = JSON.stringify(contractAddresses, null, 2);

  fs.writeFileSync("../backend/src/config/contractAddress.json", addressesJson);
  fs.writeFileSync(
    "../frontend/src/config/contractAddress.json",
    addressesJson,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
