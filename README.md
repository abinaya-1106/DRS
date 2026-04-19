# Decentralized Rental System

## Overview
A full-stack rental platform with blockchain-based agreement storage.

## Tech Stack
- Frontend: React (Vite)
- Backend: Node.js + Express
- Database: MySQL
- Blockchain: Hardhat + Solidity

## Project Structure
/frontend   → React app  
/backend    → Express API  
/blockchain → Smart contracts  

## Setup Instructions

### 1. Backend
cd backend
npm install
npm start

### 2. Frontend
cd frontend
npm install
npm run dev

### 3. Blockchain
cd blockchain
npm install
npx hardhat node
npx hardhat run scripts/deploy.js --network localhost
