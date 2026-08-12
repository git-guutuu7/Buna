import React from 'react';
import WalletCard from '../components/Wallet.jsx';

// Standalone page for the bottom-nav "Wallet" tab. Reuses the existing
// Wallet component (balance, deposit/withdraw forms, transaction history)
// which used to live embedded inside the old Dashboard layout.
export default function Wallet() {
  return (
    <div className="container" style={{ paddingBottom: 90 }}>
      <WalletCard />
    </div>
  );
}
