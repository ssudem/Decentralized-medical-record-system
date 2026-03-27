# 🏥 MediRecord — Decentralized Medical Record System

A blockchain-powered, privacy-preserving medical records platform built on **Ethereum (Sepolia)**, **IPFS (Pinata)**, and **NaCl asymmetric encryption**. MediRecord implements **Purpose-Bound & Computation-Restricted Data Access (PB-CRDA)** — ensuring patients retain full ownership of their medical data while granting fine-grained, time-limited access to authorized healthcare providers.

---

## 📋 Table of Contents

- [Key Features](#-key-features)
- [Architecture Overview](#-architecture-overview)
- [Trust Hierarchy](#-trust-hierarchy)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Smart Contract](#-smart-contract)
- [Security & Encryption](#-security--encryption)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)
- [Frontend Pages](#-frontend-pages)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment Notes](#-deployment-notes)

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **Wallet-Based Auth** | Users authenticate via MetaMask wallet signatures (no passwords) |
| **End-to-End Encryption** | Medical records are AES-256-GCM encrypted; keys are NaCl box-encrypted per user |
| **IPFS Storage** | Encrypted records are stored on IPFS via Pinata — never on centralized servers |
| **On-Chain Access Control** | Patients grant/revoke time-limited, purpose-specific access on the Ethereum blockchain |
| **Role-Based Hierarchy** | SuperAdmin → Hospital → Doctor / Diagnostics Lab → Patient chain of trust |
| **Client-Side Decryption** | Records are decrypted entirely in the browser — the server never sees plaintext |
| **Operation-Based Filtering** | Doctors can only access records tagged for their specific operation (e.g., `diabetes_check`) |
| **PDF Support** | Doctors and labs can upload encrypted PDF reports alongside structured JSON data |
| **Diagnostics Labs** | Labs can upload lab reports that are encrypted for the patient automatically |

---

## 🏗 Architecture Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                          FRONTEND (React + Vite)                      │
│                                                                       │
│   MetaMask Wallet ◄──► AuthContext ◄──► NaCl Crypto (TweetNaCl)       │
│         │                    │                    │                    │
│   Blockchain.js ◄────► API (Axios) ◄────► naclCrypto.js               │
│    (ethers.js)               │              (client-side decrypt)      │
│         │                    │                                        │
└─────────┼────────────────────┼────────────────────────────────────────┘
          │                    │
          ▼                    ▼
┌──────────────────-┐  ┌──────────────────────────────────────────────────┐
│  Ethereum Sepolia │  │           BACKEND (Express.js + Node.js)         │
│                   │  │                                                  │
│  Smart Contract   │  │   routes/     services/       utils/             │
│  - Access Control │  │   ├ auth      ├ blockchain    └ crypto.js        │
│  - Record CIDs    │  │   ├ records   ├ ipfsService      (AES-256-GCM)   │
│  - Permissions    │  │   ├ access    ├ keyStore                         │
│  - Trust Chain    │  │   ├ hospitals ├ userStore                        │
│                   │  │   ├ requests  ├ requestStore                     │
│                   │  │   └ diagnostics └ keyManager                     │
│                   │  │                                                  │
└──────────────────-┘  └───────────┬──────────────┬───────────────────────┘
                                   │              │
                                   ▼              ▼
                          ┌──────────────┐ ┌──────────────┐
                          │  MySQL/TiDB  │ │  Pinata IPFS │
                          │  Cloud       │ │  (Encrypted  │
                          │  - Users     │ │   Records)   │
                          │  - Keys      │ │              │
                          │  - Requests  │ │              │
                          └──────────────┘ └──────────────┘
```

---

## 🔐 Trust Hierarchy

The system enforces a multi-level trust chain managed entirely on-chain:

```
SuperAdmin (Contract Deployer / Regulatory Body)
    │
    ├──► registerHospital(address)    ── adds a trusted hospital
    ├──► removeHospital(address)      ── removes a hospital (cascading)
    │
    Hospital (Registered by SuperAdmin)
        │
        ├──► authorizeDoctor(address)           ── authorizes a doctor
        ├──► unauthorizeDoctor(address)          ── revokes a doctor
        ├──► authorizeDiagnosticsLab(address)    ── authorizes a lab
        ├──► unauthorizeDiagnosticsLab(address)  ── revokes a lab
        │
        Doctor (Authorized by Hospital)
        │   ├──► uploadRecord(patient, CID)  ── links record to patient
        │   └──► viewRecords (via off-chain permission check)
        │
        Diagnostics Lab (Authorized by Hospital)
            └──► uploadRecordLab(patient, CID)  ── links lab report
```

> **Cascading Removal:** Removing a hospital automatically invalidates all doctors and labs under it — they can no longer perform any on-chain operations.

---

## 🛠 Tech Stack

### Backend
| Technology | Purpose |
|-----------|---------|
| **Node.js + Express** | REST API server |
| **ethers.js v6** | Blockchain interaction (Ethereum Sepolia) |
| **TweetNaCl** | NaCl asymmetric encryption (key wrapping) |
| **mysql2** | Database client (TiDB Cloud / MySQL) |
| **Multer** | PDF file upload handling |
| **JWT (jsonwebtoken)** | Session tokens |
| **Axios + FormData** | Pinata IPFS uploads |

### Frontend
| Technology | Purpose |
|-----------|---------|
| **React 19 + Vite 8** | UI framework and build tool |
| **Tailwind CSS v4** | Styling and design system |
| **ethers.js v6** | MetaMask wallet integration |
| **TweetNaCl** | Client-side AES key decryption |
| **React Router v7** | Page routing and navigation |
| **Lucide React** | Icon library |
| **Axios** | HTTP client for backend API |

### Blockchain & Storage
| Technology | Purpose |
|-----------|---------|
| **Solidity 0.8.19** | Smart contract (access control, record registry) |
| **Ethereum Sepolia** | Testnet for deployment |
| **Pinata / IPFS** | Decentralized encrypted record storage |
| **TiDB Cloud** | Serverless MySQL for key storage and user data |

---

## 📁 Project Structure

```
MediRecord/
├── Backend/
│   ├── server.js                 # Express entry point
│   ├── contracts/
│   │   └── MedicalRecordSystem.sol   # Solidity smart contract
│   ├── routes/
│   │   ├── auth.js               # Registration, login (wallet-based)
│   │   ├── records.js            # Create & view encrypted records
│   │   ├── access.js             # Grant/revoke AES key access
│   │   ├── hospitals.js          # Hospital/doctor/lab management
│   │   ├── requests.js           # Doctor → Patient access requests
│   │   └── diagnostics.js        # Lab report upload
│   ├── services/
│   │   ├── blockchain.js         # Ethers.js contract interaction
│   │   ├── ipfsService.js        # Pinata IPFS upload/fetch
│   │   ├── keyStore.js           # Encrypted AES key storage (MySQL)
│   │   ├── keyManager.js         # NaCl key management utilities
│   │   ├── userStore.js          # User CRUD operations (MySQL)
│   │   └── requestStore.js       # Access request CRUD (MySQL)
│   ├── utils/
│   │   └── crypto.js             # AES-256-GCM encryption utilities
│   ├── config/
│   │   └── operationTags.js      # Operation → tag mapping config
│   ├── middleware/
│   │   └── authMiddleware.js     # JWT verification middleware
│   ├── database_schema.db        # MySQL schema definitions
│   ├── contractABI.json          # Smart contract ABI
│   ├── .env.example              # Environment variable template
│   └── package.json
│
└── Frontend/
    ├── index.html
    ├── vite.config.js
    ├── src/
    │   ├── App.jsx               # Router and route definitions
    │   ├── main.jsx              # React entry point
    │   ├── index.css             # Global styles and design tokens
    │   ├── contractABI.json      # Smart contract ABI (frontend copy)
    │   ├── context/
    │   │   └── AuthContext.jsx   # Wallet auth state management
    │   ├── components/
    │   │   ├── Navbar.jsx        # Navigation bar
    │   │   └── UI.jsx            # Reusable UI components (Card, Button, Input, Toast)
    │   ├── pages/
    │   │   ├── Login.jsx             # MetaMask wallet login
    │   │   ├── Register.jsx          # New user registration
    │   │   ├── PatientDashboard.jsx  # Patient home — pending requests, quick actions
    │   │   ├── PatientRecords.jsx    # Patient's own medical records
    │   │   ├── GrantAccess.jsx       # Grant time-limited access to a doctor
    │   │   ├── RevokeAccess.jsx      # Revoke a doctor's access
    │   │   ├── DoctorDashboard.jsx   # Doctor home
    │   │   ├── CreateRecord.jsx      # Doctor creates an encrypted record
    │   │   ├── ViewRecords.jsx       # Doctor views patient records
    │   │   ├── RequestAccess.jsx     # Doctor requests patient access
    │   │   ├── RecordViewer.jsx      # Decrypted record display (JSON + PDF)
    │   │   ├── DiagnosticsDashboard.jsx  # Lab technician home
    │   │   ├── UploadDiagnostics.jsx     # Lab uploads encrypted report
    │   │   ├── AdminPanel.jsx        # SuperAdmin — add/remove hospitals
    │   │   └── HospitalPanel.jsx     # Hospital — manage doctors/labs
    │   ├── utils/
    │   │   ├── blockchain.js     # MetaMask contract interaction wrappers
    │   │   └── naclCrypto.js     # Client-side NaCl key operations
    │   ├── constants/
    │   │   ├── operations.js     # Operation type definitions
    │   │   └── specialties.js    # Medical specialty definitions
    │   └── api/
    │       └── axios.js          # Axios instance with base URL
    └── package.json
```

---

## 📜 Smart Contract

**File:** `Backend/contracts/MedicalRecordSystem.sol`  
**Solidity:** `^0.8.19`  
**Network:** Ethereum Sepolia Testnet

### Key Functions

| Function | Caller | Description |
|----------|--------|-------------|
| `registerHospital(address)` | SuperAdmin | Register a trusted hospital |
| `removeHospital(address)` | SuperAdmin | Remove a hospital (cascading) |
| `authorizeDoctor(address)` | Hospital | Authorize a doctor under this hospital |
| `unauthorizeDoctor(address)` | Hospital | Revoke a doctor's authorization |
| `authorizeDiagnosticsLab(address)` | Hospital | Authorize a diagnostics lab |
| `unauthorizeDiagnosticsLab(address)` | Hospital | Revoke a lab's authorization |
| `uploadRecord(patient, CID)` | Doctor | Link an IPFS CID to a patient |
| `uploadRecordLab(patient, CID)` | Lab | Link a lab report CID to a patient |
| `grantAccess(doctor, op, purpose, duration)` | Patient | Grant time-limited access |
| `revokeAccess(doctor, op)` | Patient | Revoke access |
| `checkPermission(patient, doctor, op)` | Anyone | Verify active permission |
| `getPatientRecords(patient)` | SuperAdmin/Patient | Get all record CIDs |

---

## 🔒 Security & Encryption

### Encryption Flow (Record Creation)

```
1.  Doctor creates a medical record (JSON + optional PDF)
2.  Backend generates a random AES-256-GCM key + IV
3.  Record is encrypted with the AES key
4.  AES key is NaCl box-encrypted for the patient's public key
5.  Encrypted record → uploaded to IPFS (Pinata)
6.  Encrypted AES key + nonce → stored in MySQL
7.  IPFS CID → registered on-chain via smart contract
```

### Decryption Flow (Record Viewing)

```
1.  Patient/Doctor requests records via POST /api/records/view
2.  Backend fetches encrypted data from IPFS + encrypted AES key from MySQL
3.  Returns encrypted payload to the client (NO server-side decryption)
4.  Client decrypts AES key using their NaCl private key (in-browser)
5.  Client decrypts the record using the AES key
6.  Plaintext is rendered in the browser — never leaves the client
```

### Key Sharing (Access Grant)

```
1.  Patient approves a doctor's request
2.  Patient's browser decrypts their own AES key (NaCl private key)
3.  Patient's browser sends the raw AES key to the backend
4.  Backend re-encrypts the AES key for the doctor's NaCl public key
5.  Re-encrypted key is stored in MySQL for the doctor
6.  On-chain permission is granted (time-limited, operation-specific)
```

### Cryptographic Primitives

| Primitive | Usage |
|-----------|-------|
| **AES-256-GCM** | Record and PDF encryption (symmetric) |
| **NaCl box (x25519-xsalsa20-poly1305)** | AES key wrapping per user (asymmetric) |
| **ECDSA (secp256k1)** | Ethereum wallet signatures for authentication |

---

## 🗄 Database Schema

The system uses **MySQL (TiDB Cloud)** for off-chain state that cannot be stored on the blockchain for cost/privacy reasons.

### `users`
Stores user accounts with their NaCl keypair (private key encrypted with a user-derived password).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT (PK) | Auto-increment ID |
| `email` | VARCHAR(255) | User email (unique) |
| `password_hash` | VARCHAR(255) | Bcrypt password hash |
| `role` | VARCHAR(20) | `patient`, `doctor`, or `diagnostics` |
| `nacl_public_key` | TEXT | NaCl public key (Base64) |
| `encrypted_nacl_private_key` | TEXT | AES-encrypted NaCl private key |
| `ethereum_address` | VARCHAR(42) | Linked MetaMask wallet address |

### `encrypted_keys`
Stores NaCl-encrypted AES keys per user per record (CID).

| Column | Type | Description |
|--------|------|-------------|
| `cid` | VARCHAR(255) | IPFS Content ID |
| `user_address` | VARCHAR(255) | Ethereum address of the key holder |
| `encrypted_aes_key` | TEXT | NaCl-encrypted AES key (Base64) |
| `nonce` | VARCHAR(64) | NaCl nonce (Base64) |
| `sender_address` | VARCHAR(255) | NaCl public key of the encrypting party |

### `access_requests`
Tracks doctor → patient access request workflow.

| Column | Type | Description |
|--------|------|-------------|
| `patient_address` | VARCHAR(255) | Patient's Ethereum address |
| `doctor_address` | VARCHAR(255) | Doctor's Ethereum address |
| `operation` | VARCHAR(100) | Requested operation type |
| `purpose` | VARCHAR(255) | Free-text purpose description |
| `status` | ENUM | `pending`, `approved`, or `rejected` |

---

## 🌐 API Reference

### Authentication (`/api/auth`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/register` | Anyone | Register with wallet + NaCl keypair |
| POST | `/login` | Anyone | Wallet-signature-based login (returns JWT) |
| GET | `/me` | Authenticated | Get current user profile |
| GET | `/public-key/:address` | Authenticated | Get user's NaCl public key |

### Records (`/api/records`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/` | Doctor | Create & encrypt a medical record |
| POST | `/view` | Patient/Doctor | Fetch encrypted records for client-side decryption |

### Access Control (`/api/access`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/grant` | Patient | Re-encrypt AES key for a doctor |
| POST | `/revoke` | Patient | Remove a doctor's key entry |
| GET | `/keys/:cid/:address` | Any | Retrieve encrypted AES key |

### Hospitals (`/api/hospitals`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/add` | SuperAdmin | Register a hospital on-chain |
| POST | `/remove` | SuperAdmin | Remove a hospital on-chain |
| POST | `/authorize-doctor` | Hospital | Authorize a doctor |
| POST | `/unauthorize-doctor` | Hospital | Revoke a doctor |
| POST | `/authorize-diagnostics` | Hospital | Authorize a diagnostics lab |
| POST | `/unauthorize-diagnostics` | Hospital | Revoke a diagnostics lab |
| GET | `/:address/status` | Anyone | Check hospital registration status |
| GET | `/doctor/:address` | Anyone | Check doctor's linked hospital |
| GET | `/diagnostics-lab/:address` | Anyone | Check lab's linked hospital |

### Requests (`/api/requests`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/` | Doctor | Create an access request |
| GET | `/patient/:address` | Patient | Get pending requests |
| GET | `/doctor/:address` | Doctor | Get sent requests |
| PUT | `/:id/status` | Patient | Approve or reject a request |

### Diagnostics (`/api/diagnostics`)
| Method | Endpoint | Caller | Description |
|--------|----------|--------|-------------|
| POST | `/upload` | Lab | Upload encrypted diagnostics report |

---

## 🖥 Frontend Pages

| Page | Route | Role | Description |
|------|-------|------|-------------|
| Login | `/login` | All | MetaMask wallet authentication |
| Register | `/register` | All | Account creation with NaCl keypair generation |
| Patient Dashboard | `/patient` | Patient | Pending requests, quick actions |
| My Records | `/patient/my-records` | Patient | View and decrypt own medical records |
| Grant Access | `/patient/grant-access` | Patient | Select records and share with a doctor |
| Revoke Access | `/patient/revoke-access` | Patient | Remove a doctor's access to records |
| Doctor Dashboard | `/doctor` | Doctor | Home panel with actions |
| Create Record | `/doctor/create-record` | Doctor | Create encrypted medical records |
| View Records | `/doctor/view-records` | Doctor | View patient records (with permission) |
| Request Access | `/doctor/request-access` | Doctor | Request patient's approval |
| Record Viewer | `/record/:cid` | Any auth | Decrypt and display a specific record |
| Diagnostics Dashboard | `/diagnostics` | Lab | Lab technician home |
| Upload Report | `/diagnostics/upload-report` | Lab | Upload encrypted lab reports |
| Admin Panel | `/admin` | SuperAdmin | Add/remove hospitals |
| Hospital Panel | `/hospital-admin` | Hospital | Manage doctors and labs |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ and **npm**
- **MetaMask** browser extension
- **Ethereum Sepolia** testnet ETH (use a [faucet](https://sepoliafaucet.com/))
- **Pinata** account for IPFS ([https://pinata.cloud](https://pinata.cloud))
- **MySQL** database (or [TiDB Cloud](https://tidbcloud.com/) free tier)

### 1. Clone the Repository

```bash
git clone https://github.com/ssudem/MediRecord.git
cd MediRecord
```

### 2. Setup Backend

```bash
cd Backend
npm install
```

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Initialize the database by running the SQL in `database_schema.db` against your MySQL instance.

Start the server:

```bash
npm start
```

The backend will start on `http://localhost:3001`.

### 3. Setup Frontend

```bash
cd Frontend
npm install
npm run dev
```

The frontend will start on `http://localhost:5173`.

### 4. Deploy the Smart Contract

1. Compile and deploy `MedicalRecordSystem.sol` to Ethereum Sepolia using [Remix IDE](https://remix.ethereum.org/) or Hardhat.
2. Copy the deployed contract address.
3. Update `CONTRACT_ADDRESS` in:
   - `Backend/.env`
   - `Frontend/src/utils/blockchain.js` (line 4)
4. Update both `contractABI.json` files if the contract interface changed.

---

## ⚙️ Environment Variables

Create a `.env` file in the `Backend/` directory (see `.env.example`):

| Variable | Description |
|----------|-------------|
| `BLOCKCHAIN_RPC_URL` | Ethereum Sepolia JSON-RPC endpoint (Alchemy/Infura) |
| `SERVER_PRIVATE_KEY` | SuperAdmin wallet private key (contract deployer) |
| `CONTRACT_ADDRESS` | Deployed MedicalRecordSystem contract address |
| `PINATA_API_KEY` | Pinata API key |
| `PINATA_API_SECRET` | Pinata API secret |
| `PINATA_JWT` | Pinata JWT for gateway access |
| `DB_HOST` | MySQL/TiDB host |
| `DB_PORT` | Database port (default: 4000 for TiDB) |
| `DB_USER` | Database username |
| `DB_PASSWORD` | Database password |
| `DB_NAME` | Database name |
| `CA` | Path to SSL CA cert (for TiDB Cloud) |
| `PORT` | Backend server port (default: 3001) |
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | JWT token lifetime (e.g., `8h`) |

---

## 📝 Deployment Notes

1. **Smart Contract Redeployment:** Any changes to `MedicalRecordSystem.sol` require redeployment. Update `CONTRACT_ADDRESS` and both ABI files afterward.
2. **Private Keys:** The `SERVER_PRIVATE_KEY` is used only for on-chain operations (adding hospitals). It is never exposed to API responses or logs.
3. **NaCl Keypairs:** Each user generates a NaCl keypair at registration. The private key is AES-encrypted with a password-derived key and stored in the database.
4. **Client-Side Decryption:** Medical record data is **never** decrypted on the server. The server only stores and relays encrypted payloads and encrypted keys.
5. **IPFS Persistence:** Records pinned on Pinata persist as long as the Pinata account is active. Consider implementing CID pinning verification for production.

---

## 📄 License

MIT

---

<p align="center">
  Built with ❤️ for decentralized healthcare
</p>
