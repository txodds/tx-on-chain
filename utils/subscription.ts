import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, Account } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";

export async function checkSubscriptionStatus(
  program: Program,
  userKeypair: Keypair,
  tokenMint: PublicKey
): Promise<{ hasActiveSubscription: boolean; unlockTs?: number }> {
  const [stakeAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKeypair.publicKey.toBuffer(), tokenMint.toBuffer()],
    program.programId
  );

  try {
    const stakeAccount: any = await (program.account as any).stakeAccount.fetch(stakeAccountPda);
    const currentTime = Math.floor(Date.now() / 1000);
    const unlockTs = stakeAccount.unlockTs?.toNumber() || 0;
    const hasActiveSubscription = unlockTs > currentTime;

    return {
      hasActiveSubscription,
      unlockTs: hasActiveSubscription ? unlockTs : undefined,
    };
  } catch (error) {
    return { hasActiveSubscription: false };
  }
}

export async function subscribeWithStake(
  program: Program,
  userKeypair: Keypair,
  userTokenAccount: Account,
  tokenMint: PublicKey,
  encryptedPayload: Buffer,
  userLabel: string = "User"
): Promise<string> {
  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  const [stakeAccountPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake"), userKeypair.publicKey.toBuffer(), tokenMint.toBuffer()],
    program.programId
  );

  const [stakeVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), userKeypair.publicKey.toBuffer(), tokenMint.toBuffer()],
    program.programId
  );

  const connection = program.provider.connection;
  const stakeAccountInfo = await connection.getAccountInfo(stakeAccountPda);

  if (!stakeAccountInfo) {
    console.log(`[${userLabel}] Creating stake account and depositing tokens...`);

    const stakeTxSig = await program.methods
      .stake()
      .accounts({
        user: userKeypair.publicKey,
        oracleState: oracleStatePda,
        stakeAccount: stakeAccountPda,
        stakeVault: stakeVaultPda,
        userTokenAccount: userTokenAccount.address,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([userKeypair])
      .rpc();

    console.log(`[${userLabel}] Stake transaction signature: ${stakeTxSig}`);
  } else {
    console.log(`[${userLabel}] Stake account already exists, skipping stake step.`);
  }

  // Check for active subscription
  const status = await checkSubscriptionStatus(program, userKeypair, tokenMint);
  let endTs: BN;

  if (status.hasActiveSubscription) {
    const expiryDate = new Date(status.unlockTs! * 1000);
    console.log(`[${userLabel}] You already have an active subscription until ${expiryDate.toISOString()}`);
    console.log(`[${userLabel}] Re-authenticating with existing subscription...`);

    // Reuse the existing unlockTs as endTs for re-authentication
    endTs = new BN(status.unlockTs!);
  } else {
    console.log(`[${userLabel}] Subscribing with staked tokens...`);

    // Calculate subscription end time (e.g., 30 days from now)
    const subscriptionDurationSeconds = 30 * 24 * 60 * 60; // 30 days
    endTs = new BN(Math.floor(Date.now() / 1000) + subscriptionDurationSeconds);
  }

  const subscribeTxSig = await program.methods
    .subscribe(encryptedPayload, endTs)
    .accounts({
      user: userKeypair.publicKey,
      oracleState: oracleStatePda,
      tokenMint: tokenMint,
      stakeAccount: stakeAccountPda,
      stakeVault: stakeVaultPda,
    })
    .signers([userKeypair])
    .rpc();

  console.log(`[${userLabel}] Subscription successful! Stake is locked.`);
  console.log(`[${userLabel}] Transaction Signature: ${subscribeTxSig}`);

  return subscribeTxSig;
}

export async function subscribeWithTokenPayment(
  program: Program,
  userKeypair: Keypair,
  userTokenAccount: Account,
  tokenMint: PublicKey,
  encryptedPayload: Buffer,
  userLabel: string = "User"
): Promise<string> {
  const [oracleStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_state")],
    program.programId
  );

  const [tokenTreasuryVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury")],
    program.programId
  );

  const txSig = await program.methods
    .subscribeWithToken(encryptedPayload)
    .accounts({
      user: userKeypair.publicKey,
      tokenMint: tokenMint,
      oracleState: oracleStatePda,
      tokenTreasuryVault: tokenTreasuryVaultPda,
      userTokenAccount: userTokenAccount.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([userKeypair])
    .rpc();

  console.log(`[${userLabel}] Subscription successful!`);
  console.log(`[${userLabel}] Transaction Signature: ${txSig}`);

  return txSig;
}

export async function handleSubscription(
  program: Program,
  userKeypair: Keypair,
  userTokenAccount: Account,
  tokenMint: PublicKey,
  encryptedPayload: Buffer,
  userLabel: string = "User"
): Promise<string> {
  const useStakeMethod = process.argv.includes("--stake");

  if (useStakeMethod) {
    console.log(`[${userLabel}] Using stakeWithStake method...`);
    return await subscribeWithStake(
      program,
      userKeypair,
      userTokenAccount,
      tokenMint,
      encryptedPayload,
      userLabel
    );
  } else {
    console.log(`[${userLabel}] Using subscribeWithToken method...`);
    return await subscribeWithTokenPayment(
      program,
      userKeypair,
      userTokenAccount,
      tokenMint,
      encryptedPayload,
      userLabel
    );
  }
}
