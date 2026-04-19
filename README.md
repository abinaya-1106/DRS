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
cd backend<br>
npm install<br>
npm start<br>

### 2. Frontend
cd frontend<br>
npm install<br> 
npm run dev<br>

### 3. Blockchain
cd blockchain<br>
npm install<br>
npx hardhat node<br>
npx hardhat run scripts/deploy.js --network localhost<br>
