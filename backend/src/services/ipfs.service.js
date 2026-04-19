import pinataSDK from "@pinata/sdk";
import { Readable } from "stream";
import path from "path";
import { PINATA_CONFIG } from "../config/env.js";

const pinata = new pinataSDK(PINATA_CONFIG.API_KEY, PINATA_CONFIG.API_SECRET);

export const uploadAgreementOnIPFS = async (
  pdfBuffer,
  landlordID,
  tenantID,
) => {
  const stream = Readable.from([pdfBuffer]);

  const options = {
    pinataMetadata: {
      name: `rental-agreement-${landlordID}-${tenantID}.pdf`,
    },
  };

  const result = await pinata.pinFileToIPFS(stream, options);

  return result.IpfsHash;
};
