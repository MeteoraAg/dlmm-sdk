/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lb_clmm.json`.
 */
export type LbClmm = {
  address: "LbVRzDTvBDEcrthxfZ4RL6yiq3uZw8bS6MwtdY6UhFQ";
  metadata: {
    name: "lbClmm";
    version: "0.9.1";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "addLiquidity";
      discriminator: [181, 157, 89, 67, 143, 182, 52, 72];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameter";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidity2";
      discriminator: [228, 162, 78, 28, 70, 219, 116, 115];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameter";
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityByStrategy";
      discriminator: [7, 3, 150, 127, 148, 40, 61, 200];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameterByStrategy";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityByStrategy2";
      discriminator: [3, 221, 149, 218, 111, 141, 118, 213];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameterByStrategy";
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityByStrategyOneSide";
      discriminator: [41, 5, 238, 175, 100, 225, 6, 205];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userToken";
          writable: true;
        },
        {
          name: "reserve";
          writable: true;
        },
        {
          name: "tokenMint";
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameterByStrategyOneSide";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityByWeight";
      discriminator: [28, 140, 238, 99, 231, 162, 21, 149];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityParameterByWeight";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityOneSide";
      discriminator: [94, 155, 103, 151, 70, 95, 220, 165];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userToken";
          writable: true;
        },
        {
          name: "reserve";
          writable: true;
        },
        {
          name: "tokenMint";
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "liquidityOneSideParameter";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityOneSidePrecise";
      discriminator: [161, 194, 103, 84, 171, 71, 250, 154];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userToken";
          writable: true;
        },
        {
          name: "reserve";
          writable: true;
        },
        {
          name: "tokenMint";
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "parameter";
          type: {
            defined: {
              name: "addLiquiditySingleSidePreciseParameter";
            };
          };
        },
      ];
    },
    {
      name: "addLiquidityOneSidePrecise2";
      discriminator: [33, 51, 163, 201, 117, 98, 125, 231];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userToken";
          writable: true;
        },
        {
          name: "reserve";
          writable: true;
        },
        {
          name: "tokenMint";
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "liquidityParameter";
          type: {
            defined: {
              name: "addLiquiditySingleSidePreciseParameter2";
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimFee";
      discriminator: [169, 32, 79, 137, 136, 232, 70, 137];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayLower", "binArrayUpper"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "claimFee2";
      discriminator: [112, 191, 101, 171, 28, 144, 127, 187];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenProgramX";
        },
        {
          name: "tokenProgramY";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "minBinId";
          type: "i32";
        },
        {
          name: "maxBinId";
          type: "i32";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "claimReward";
      discriminator: [149, 95, 181, 242, 94, 90, 158, 162];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayLower", "binArrayUpper"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "userTokenAccount";
          writable: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
      ];
    },
    {
      name: "claimReward2";
      discriminator: [190, 3, 127, 119, 178, 87, 157, 183];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "userTokenAccount";
          writable: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "minBinId";
          type: "i32";
        },
        {
          name: "maxBinId";
          type: "i32";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "closeClaimProtocolFeeOperator";
      discriminator: [8, 41, 87, 35, 80, 48, 121, 26];
      accounts: [
        {
          name: "claimFeeOperator";
          writable: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "admin";
          signer: true;
        },
      ];
      args: [];
    },
    {
      name: "closePosition";
      discriminator: [123, 134, 81, 0, 49, 68, 98, 98];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayLower", "binArrayUpper"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closePosition2";
      discriminator: [174, 90, 35, 115, 186, 40, 147, 226];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closePositionIfEmpty";
      discriminator: [59, 124, 212, 118, 91, 152, 110, 157];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "closePresetParameter";
      discriminator: [4, 148, 145, 100, 134, 26, 181, 61];
      accounts: [
        {
          name: "presetParameter";
          writable: true;
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "closePresetParameter2";
      discriminator: [39, 25, 95, 107, 116, 17, 115, 28];
      accounts: [
        {
          name: "presetParameter";
          writable: true;
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "rentReceiver";
          writable: true;
        },
      ];
      args: [];
    },
    {
      name: "createClaimProtocolFeeOperator";
      discriminator: [51, 19, 150, 252, 105, 157, 48, 91];
      accounts: [
        {
          name: "claimFeeOperator";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [99, 102, 95, 111, 112, 101, 114, 97, 116, 111, 114];
              },
              {
                kind: "account";
                path: "operator";
              },
            ];
          };
        },
        {
          name: "operator";
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "decreasePositionLength";
      discriminator: [194, 219, 136, 32, 25, 96, 105, 37];
      accounts: [
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "owner";
          signer: true;
          relations: ["position"];
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lengthToRemove";
          type: "u16";
        },
        {
          name: "side";
          type: "u8";
        },
      ];
    },
    {
      name: "forIdlTypeGenerationDoNotCall";
      discriminator: [180, 105, 69, 80, 95, 50, 73, 108];
      accounts: [
        {
          name: "dummyZcAccount";
        },
      ];
      args: [
        {
          name: "ix";
          type: {
            defined: {
              name: "dummyIx";
            };
          };
        },
      ];
    },
    {
      name: "fundReward";
      discriminator: [188, 50, 249, 165, 93, 151, 38, 63];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArray"];
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "funderTokenAccount";
          writable: true;
        },
        {
          name: "funder";
          signer: true;
        },
        {
          name: "binArray";
          writable: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "carryForward";
          type: "bool";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "goToABin";
      discriminator: [146, 72, 174, 224, 40, 253, 84, 174];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension", "fromBinArray", "toBinArray"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "fromBinArray";
          optional: true;
        },
        {
          name: "toBinArray";
          optional: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "binId";
          type: "i32";
        },
      ];
    },
    {
      name: "increaseOracleLength";
      discriminator: [190, 61, 125, 87, 103, 79, 158, 173];
      accounts: [
        {
          name: "oracle";
          writable: true;
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lengthToAdd";
          type: "u64";
        },
      ];
    },
    {
      name: "increasePositionLength";
      discriminator: [80, 83, 117, 211, 66, 13, 33, 149];
      accounts: [
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "lbPair";
          relations: ["position"];
        },
        {
          name: "position";
          writable: true;
        },
        {
          name: "owner";
          signer: true;
          relations: ["position"];
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lengthToAdd";
          type: "u16";
        },
        {
          name: "side";
          type: "u8";
        },
      ];
    },
    {
      name: "initializeBinArray";
      discriminator: [35, 86, 19, 185, 78, 212, 75, 211];
      accounts: [
        {
          name: "lbPair";
        },
        {
          name: "binArray";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 110, 95, 97, 114, 114, 97, 121];
              },
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "arg";
                path: "index";
              },
            ];
          };
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "index";
          type: "i64";
        },
      ];
    },
    {
      name: "initializeBinArrayBitmapExtension";
      discriminator: [47, 157, 226, 180, 12, 240, 33, 71];
      accounts: [
        {
          name: "lbPair";
        },
        {
          name: "binArrayBitmapExtension";
          docs: [
            "Initialize an account to store if a bin array is initialized.",
          ];
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "initializeCustomizablePermissionlessLbPair";
      discriminator: [46, 39, 41, 135, 111, 183, 200, 64];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "tokenMintX";
        },
        {
          name: "tokenMintY";
        },
        {
          name: "reserveX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintX";
              },
            ];
          };
        },
        {
          name: "reserveY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintY";
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "userTokenX";
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "userTokenY";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "params";
          type: {
            defined: {
              name: "customizableParams";
            };
          };
        },
      ];
    },
    {
      name: "initializeCustomizablePermissionlessLbPair2";
      discriminator: [243, 73, 129, 126, 51, 19, 241, 107];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "tokenMintX";
        },
        {
          name: "tokenMintY";
        },
        {
          name: "reserveX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintX";
              },
            ];
          };
        },
        {
          name: "reserveY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintY";
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "userTokenX";
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "tokenProgramX";
        },
        {
          name: "tokenProgramY";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "userTokenY";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "params";
          type: {
            defined: {
              name: "customizableParams";
            };
          };
        },
      ];
    },
    {
      name: "initializeLbPair";
      discriminator: [45, 154, 237, 210, 221, 15, 166, 92];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "tokenMintX";
        },
        {
          name: "tokenMintY";
        },
        {
          name: "reserveX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintX";
              },
            ];
          };
        },
        {
          name: "reserveY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintY";
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "presetParameter";
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "activeId";
          type: "i32";
        },
        {
          name: "binStep";
          type: "u16";
        },
      ];
    },
    {
      name: "initializeLbPair2";
      discriminator: [73, 59, 36, 120, 237, 83, 108, 198];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "tokenMintX";
        },
        {
          name: "tokenMintY";
        },
        {
          name: "reserveX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintX";
              },
            ];
          };
        },
        {
          name: "reserveY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintY";
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "presetParameter";
        },
        {
          name: "funder";
          writable: true;
          signer: true;
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "tokenProgramX";
        },
        {
          name: "tokenProgramY";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "params";
          type: {
            defined: {
              name: "initializeLbPair2Params";
            };
          };
        },
      ];
    },
    {
      name: "initializePermissionLbPair";
      discriminator: [108, 102, 213, 85, 251, 3, 53, 21];
      accounts: [
        {
          name: "base";
          signer: true;
        },
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [98, 105, 116, 109, 97, 112];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "tokenMintX";
        },
        {
          name: "tokenMintY";
        },
        {
          name: "reserveX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintX";
              },
            ];
          };
        },
        {
          name: "reserveY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "tokenMintY";
              },
            ];
          };
        },
        {
          name: "oracle";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [111, 114, 97, 99, 108, 101];
              },
              {
                kind: "account";
                path: "lbPair";
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "tokenBadgeX";
          optional: true;
        },
        {
          name: "tokenBadgeY";
          optional: true;
        },
        {
          name: "tokenProgramX";
        },
        {
          name: "tokenProgramY";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "ixData";
          type: {
            defined: {
              name: "initPermissionPairIx";
            };
          };
        },
      ];
    },
    {
      name: "initializePosition";
      discriminator: [219, 192, 234, 71, 190, 191, 102, 80];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "position";
          writable: true;
          signer: true;
        },
        {
          name: "lbPair";
        },
        {
          name: "owner";
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lowerBinId";
          type: "i32";
        },
        {
          name: "width";
          type: "i32";
        },
      ];
    },
    {
      name: "initializePositionByOperator";
      discriminator: [251, 189, 190, 244, 117, 254, 35, 148];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "base";
          signer: true;
        },
        {
          name: "position";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 111, 115, 105, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "base";
              },
              {
                kind: "arg";
                path: "lowerBinId";
              },
              {
                kind: "arg";
                path: "width";
              },
            ];
          };
        },
        {
          name: "lbPair";
        },
        {
          name: "owner";
        },
        {
          name: "operator";
          docs: ["operator"];
          signer: true;
        },
        {
          name: "operatorTokenX";
        },
        {
          name: "ownerTokenX";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lowerBinId";
          type: "i32";
        },
        {
          name: "width";
          type: "i32";
        },
        {
          name: "feeOwner";
          type: "pubkey";
        },
        {
          name: "lockReleasePoint";
          type: "u64";
        },
      ];
    },
    {
      name: "initializePositionPda";
      discriminator: [46, 82, 125, 146, 85, 141, 228, 153];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "base";
          signer: true;
        },
        {
          name: "position";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 111, 115, 105, 116, 105, 111, 110];
              },
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "account";
                path: "base";
              },
              {
                kind: "arg";
                path: "lowerBinId";
              },
              {
                kind: "arg";
                path: "width";
              },
            ];
          };
        },
        {
          name: "lbPair";
        },
        {
          name: "owner";
          docs: ["owner"];
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "lowerBinId";
          type: "i32";
        },
        {
          name: "width";
          type: "i32";
        },
      ];
    },
    {
      name: "initializePresetParameter";
      discriminator: [66, 188, 71, 211, 98, 109, 14, 186];
      accounts: [
        {
          name: "presetParameter";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116,
                  95,
                  112,
                  97,
                  114,
                  97,
                  109,
                  101,
                  116,
                  101,
                  114,
                ];
              },
              {
                kind: "arg";
                path: "ix.bin_step";
              },
              {
                kind: "arg";
                path: "ix.base_factor";
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "ix";
          type: {
            defined: {
              name: "initPresetParametersIx";
            };
          };
        },
      ];
    },
    {
      name: "initializePresetParameter2";
      discriminator: [184, 7, 240, 171, 103, 47, 183, 121];
      accounts: [
        {
          name: "presetParameter";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  112,
                  114,
                  101,
                  115,
                  101,
                  116,
                  95,
                  112,
                  97,
                  114,
                  97,
                  109,
                  101,
                  116,
                  101,
                  114,
                  50,
                ];
              },
              {
                kind: "arg";
                path: "ix.index";
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "ix";
          type: {
            defined: {
              name: "initPresetParameters2Ix";
            };
          };
        },
      ];
    },
    {
      name: "initializeReward";
      discriminator: [95, 135, 192, 196, 242, 129, 230, 68];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "rewardVault";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "account";
                path: "lbPair";
              },
              {
                kind: "arg";
                path: "rewardIndex";
              },
            ];
          };
        },
        {
          name: "rewardMint";
        },
        {
          name: "tokenBadge";
          optional: true;
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rent";
          address: "SysvarRent111111111111111111111111111111111";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "rewardDuration";
          type: "u64";
        },
        {
          name: "funder";
          type: "pubkey";
        },
      ];
    },
    {
      name: "initializeTokenBadge";
      discriminator: [253, 77, 205, 95, 27, 224, 89, 223];
      accounts: [
        {
          name: "tokenMint";
        },
        {
          name: "tokenBadge";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [116, 111, 107, 101, 110, 95, 98, 97, 100, 103, 101];
              },
              {
                kind: "account";
                path: "tokenMint";
              },
            ];
          };
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [];
    },
    {
      name: "migrateBinArray";
      discriminator: [17, 23, 159, 211, 101, 184, 41, 241];
      accounts: [
        {
          name: "lbPair";
        },
      ];
      args: [];
    },
    {
      name: "migratePosition";
      discriminator: [15, 132, 59, 50, 199, 6, 251, 46];
      accounts: [
        {
          name: "positionV2";
          writable: true;
          signer: true;
        },
        {
          name: "positionV1";
          writable: true;
        },
        {
          name: "lbPair";
          relations: ["positionV1", "binArrayLower", "binArrayUpper"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "owner";
          writable: true;
          signer: true;
          relations: ["positionV1"];
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "rentReceiver";
          writable: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "removeAllLiquidity";
      discriminator: [10, 51, 61, 35, 112, 105, 24, 85];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [];
    },
    {
      name: "removeLiquidity";
      discriminator: [80, 85, 209, 72, 24, 206, 177, 108];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "binLiquidityRemoval";
          type: {
            vec: {
              defined: {
                name: "binLiquidityReduction";
              };
            };
          };
        },
      ];
    },
    {
      name: "removeLiquidity2";
      discriminator: [230, 215, 82, 127, 241, 101, 227, 146];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "binLiquidityRemoval";
          type: {
            vec: {
              defined: {
                name: "binLiquidityReduction";
              };
            };
          };
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "removeLiquidityByRange";
      discriminator: [26, 82, 102, 152, 240, 74, 105, 26];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: [
            "position",
            "binArrayBitmapExtension",
            "binArrayLower",
            "binArrayUpper",
          ];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "fromBinId";
          type: "i32";
        },
        {
          name: "toBinId";
          type: "i32";
        },
        {
          name: "bpsToRemove";
          type: "u16";
        },
      ];
    },
    {
      name: "removeLiquidityByRange2";
      discriminator: [204, 2, 195, 145, 53, 145, 145, 205];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          writable: true;
          optional: true;
        },
        {
          name: "userTokenX";
          writable: true;
        },
        {
          name: "userTokenY";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "sender";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "fromBinId";
          type: "i32";
        },
        {
          name: "toBinId";
          type: "i32";
        },
        {
          name: "bpsToRemove";
          type: "u16";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "setActivationPoint";
      discriminator: [91, 249, 15, 165, 26, 129, 254, 125];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "admin";
          writable: true;
          signer: true;
        },
      ];
      args: [
        {
          name: "activationPoint";
          type: "u64";
        },
      ];
    },
    {
      name: "setPairStatus";
      discriminator: [67, 248, 231, 137, 154, 149, 217, 174];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "admin";
          signer: true;
        },
      ];
      args: [
        {
          name: "status";
          type: "u8";
        },
      ];
    },
    {
      name: "setPairStatusPermissionless";
      discriminator: [78, 59, 152, 211, 70, 183, 46, 208];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "creator";
          signer: true;
          relations: ["lbPair"];
        },
      ];
      args: [
        {
          name: "status";
          type: "u8";
        },
      ];
    },
    {
      name: "setPreActivationDuration";
      discriminator: [165, 61, 201, 244, 130, 159, 22, 100];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "creator";
          signer: true;
          relations: ["lbPair"];
        },
      ];
      args: [
        {
          name: "preActivationDuration";
          type: "u64";
        },
      ];
    },
    {
      name: "setPreActivationSwapAddress";
      discriminator: [57, 139, 47, 123, 216, 80, 223, 10];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "creator";
          signer: true;
          relations: ["lbPair"];
        },
      ];
      args: [
        {
          name: "preActivationSwapAddress";
          type: "pubkey";
        },
      ];
    },
    {
      name: "swap";
      discriminator: [248, 198, 158, 145, 225, 117, 135, 200];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "amountIn";
          type: "u64";
        },
        {
          name: "minAmountOut";
          type: "u64";
        },
      ];
    },
    {
      name: "swap2";
      discriminator: [65, 75, 63, 76, 235, 91, 91, 136];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "amountIn";
          type: "u64";
        },
        {
          name: "minAmountOut";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "swapExactOut";
      discriminator: [250, 73, 101, 33, 38, 207, 75, 184];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "maxInAmount";
          type: "u64";
        },
        {
          name: "outAmount";
          type: "u64";
        },
      ];
    },
    {
      name: "swapExactOut2";
      discriminator: [43, 215, 247, 132, 137, 60, 243, 81];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "maxInAmount";
          type: "u64";
        },
        {
          name: "outAmount";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "swapWithPriceImpact";
      discriminator: [56, 173, 230, 208, 173, 228, 156, 205];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "tokenYProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "amountIn";
          type: "u64";
        },
        {
          name: "activeId";
          type: {
            option: "i32";
          };
        },
        {
          name: "maxPriceImpactBps";
          type: "u16";
        },
      ];
    },
    {
      name: "swapWithPriceImpact2";
      discriminator: [74, 98, 192, 214, 177, 51, 75, 51];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArrayBitmapExtension"];
        },
        {
          name: "binArrayBitmapExtension";
          optional: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "userTokenIn";
          writable: true;
        },
        {
          name: "userTokenOut";
          writable: true;
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "oracle";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "hostFeeIn";
          writable: true;
          optional: true;
        },
        {
          name: "user";
          signer: true;
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "amountIn";
          type: "u64";
        },
        {
          name: "activeId";
          type: {
            option: "i32";
          };
        },
        {
          name: "maxPriceImpactBps";
          type: "u16";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "updateBaseFeeParameters";
      discriminator: [75, 168, 223, 161, 16, 195, 3, 47];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "admin";
          signer: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "feeParameter";
          type: {
            defined: {
              name: "baseFeeParameter";
            };
          };
        },
      ];
    },
    {
      name: "updateDynamicFeeParameters";
      discriminator: [92, 161, 46, 246, 255, 189, 22, 22];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "admin";
          signer: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "feeParameter";
          type: {
            defined: {
              name: "dynamicFeeParameter";
            };
          };
        },
      ];
    },
    {
      name: "updateFeesAndReward2";
      discriminator: [32, 142, 184, 154, 103, 65, 184, 88];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position"];
        },
        {
          name: "owner";
          signer: true;
        },
      ];
      args: [
        {
          name: "minBinId";
          type: "i32";
        },
        {
          name: "maxBinId";
          type: "i32";
        },
      ];
    },
    {
      name: "updateFeesAndRewards";
      discriminator: [154, 230, 250, 13, 236, 209, 75, 223];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "lbPair";
          writable: true;
          relations: ["position", "binArrayLower", "binArrayUpper"];
        },
        {
          name: "binArrayLower";
          writable: true;
        },
        {
          name: "binArrayUpper";
          writable: true;
        },
        {
          name: "owner";
          signer: true;
        },
      ];
      args: [];
    },
    {
      name: "updatePositionOperator";
      discriminator: [202, 184, 103, 143, 180, 191, 116, 217];
      accounts: [
        {
          name: "position";
          writable: true;
        },
        {
          name: "owner";
          signer: true;
          relations: ["position"];
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "operator";
          type: "pubkey";
        },
      ];
    },
    {
      name: "updateRewardDuration";
      discriminator: [138, 174, 196, 169, 213, 235, 254, 107];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArray"];
        },
        {
          name: "admin";
          signer: true;
        },
        {
          name: "binArray";
          writable: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "newDuration";
          type: "u64";
        },
      ];
    },
    {
      name: "updateRewardFunder";
      discriminator: [211, 28, 48, 32, 215, 160, 35, 23];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "admin";
          signer: true;
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "newFunder";
          type: "pubkey";
        },
      ];
    },
    {
      name: "withdrawIneligibleReward";
      discriminator: [148, 206, 42, 195, 247, 49, 103, 8];
      accounts: [
        {
          name: "lbPair";
          writable: true;
          relations: ["binArray"];
        },
        {
          name: "rewardVault";
          writable: true;
        },
        {
          name: "rewardMint";
        },
        {
          name: "funderTokenAccount";
          writable: true;
        },
        {
          name: "funder";
          signer: true;
        },
        {
          name: "binArray";
          writable: true;
        },
        {
          name: "tokenProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
        {
          name: "eventAuthority";
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121,
                ];
              },
            ];
          };
        },
        {
          name: "program";
        },
      ];
      args: [
        {
          name: "rewardIndex";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
    {
      name: "withdrawProtocolFee";
      discriminator: [158, 201, 158, 189, 33, 93, 162, 103];
      accounts: [
        {
          name: "lbPair";
          writable: true;
        },
        {
          name: "reserveX";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "reserveY";
          writable: true;
          relations: ["lbPair"];
        },
        {
          name: "tokenXMint";
          relations: ["lbPair"];
        },
        {
          name: "tokenYMint";
          relations: ["lbPair"];
        },
        {
          name: "receiverTokenX";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  8,
                  234,
                  192,
                  109,
                  87,
                  125,
                  190,
                  55,
                  129,
                  173,
                  227,
                  8,
                  104,
                  201,
                  104,
                  13,
                  31,
                  178,
                  74,
                  80,
                  54,
                  14,
                  77,
                  78,
                  226,
                  57,
                  47,
                  122,
                  166,
                  165,
                  57,
                  144,
                ];
              },
              {
                kind: "account";
                path: "tokenXProgram";
              },
              {
                kind: "account";
                path: "tokenXMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "receiverTokenY";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  8,
                  234,
                  192,
                  109,
                  87,
                  125,
                  190,
                  55,
                  129,
                  173,
                  227,
                  8,
                  104,
                  201,
                  104,
                  13,
                  31,
                  178,
                  74,
                  80,
                  54,
                  14,
                  77,
                  78,
                  226,
                  57,
                  47,
                  122,
                  166,
                  165,
                  57,
                  144,
                ];
              },
              {
                kind: "account";
                path: "tokenYProgram";
              },
              {
                kind: "account";
                path: "tokenYMint";
              },
            ];
            program: {
              kind: "const";
              value: [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89,
              ];
            };
          };
        },
        {
          name: "claimFeeOperator";
        },
        {
          name: "operator";
          docs: ["operator"];
          signer: true;
          relations: ["claimFeeOperator"];
        },
        {
          name: "tokenXProgram";
        },
        {
          name: "tokenYProgram";
        },
        {
          name: "memoProgram";
          address: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
        },
      ];
      args: [
        {
          name: "amountX";
          type: "u64";
        },
        {
          name: "amountY";
          type: "u64";
        },
        {
          name: "remainingAccountsInfo";
          type: {
            defined: {
              name: "remainingAccountsInfo";
            };
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "binArray";
      discriminator: [92, 142, 92, 220, 5, 148, 70, 181];
    },
    {
      name: "binArrayBitmapExtension";
      discriminator: [80, 111, 124, 113, 55, 237, 18, 5];
    },
    {
      name: "claimFeeOperator";
      discriminator: [166, 48, 134, 86, 34, 200, 188, 150];
    },
    {
      name: "dummyZcAccount";
      discriminator: [94, 107, 238, 80, 208, 48, 180, 8];
    },
    {
      name: "lbPair";
      discriminator: [33, 11, 49, 98, 181, 101, 177, 13];
    },
    {
      name: "oracle";
      discriminator: [139, 194, 131, 179, 140, 179, 229, 244];
    },
    {
      name: "position";
      discriminator: [170, 188, 143, 228, 122, 64, 247, 208];
    },
    {
      name: "positionV2";
      discriminator: [117, 176, 212, 199, 245, 180, 133, 182];
    },
    {
      name: "presetParameter";
      discriminator: [242, 62, 244, 34, 181, 112, 58, 170];
    },
    {
      name: "presetParameter2";
      discriminator: [171, 236, 148, 115, 162, 113, 222, 174];
    },
    {
      name: "tokenBadge";
      discriminator: [116, 219, 204, 229, 249, 116, 255, 150];
    },
  ];
  events: [
    {
      name: "addLiquidity";
      discriminator: [31, 94, 125, 90, 227, 52, 61, 186];
    },
    {
      name: "claimFee";
      discriminator: [75, 122, 154, 48, 140, 74, 123, 163];
    },
    {
      name: "claimReward";
      discriminator: [148, 116, 134, 204, 22, 171, 85, 95];
    },
    {
      name: "compositionFee";
      discriminator: [128, 151, 123, 106, 17, 102, 113, 142];
    },
    {
      name: "decreasePositionLength";
      discriminator: [52, 118, 235, 85, 172, 169, 15, 128];
    },
    {
      name: "dynamicFeeParameterUpdate";
      discriminator: [88, 88, 178, 135, 194, 146, 91, 243];
    },
    {
      name: "feeParameterUpdate";
      discriminator: [48, 76, 241, 117, 144, 215, 242, 44];
    },
    {
      name: "fundReward";
      discriminator: [246, 228, 58, 130, 145, 170, 79, 204];
    },
    {
      name: "goToABin";
      discriminator: [59, 138, 76, 68, 138, 131, 176, 67];
    },
    {
      name: "increaseObservation";
      discriminator: [99, 249, 17, 121, 166, 156, 207, 215];
    },
    {
      name: "increasePositionLength";
      discriminator: [157, 239, 42, 204, 30, 56, 223, 46];
    },
    {
      name: "initializeReward";
      discriminator: [211, 153, 88, 62, 149, 60, 177, 70];
    },
    {
      name: "lbPairCreate";
      discriminator: [185, 74, 252, 125, 27, 215, 188, 111];
    },
    {
      name: "positionClose";
      discriminator: [255, 196, 16, 107, 28, 202, 53, 128];
    },
    {
      name: "positionCreate";
      discriminator: [144, 142, 252, 84, 157, 53, 37, 121];
    },
    {
      name: "removeLiquidity";
      discriminator: [116, 244, 97, 232, 103, 31, 152, 58];
    },
    {
      name: "swap";
      discriminator: [81, 108, 227, 190, 205, 208, 10, 196];
    },
    {
      name: "updatePositionLockReleasePoint";
      discriminator: [133, 214, 66, 224, 64, 12, 7, 191];
    },
    {
      name: "updatePositionOperator";
      discriminator: [39, 115, 48, 204, 246, 47, 66, 57];
    },
    {
      name: "updateRewardDuration";
      discriminator: [223, 245, 224, 153, 49, 29, 163, 172];
    },
    {
      name: "updateRewardFunder";
      discriminator: [224, 178, 174, 74, 252, 165, 85, 180];
    },
    {
      name: "withdrawIneligibleReward";
      discriminator: [231, 189, 65, 149, 102, 215, 154, 244];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "invalidStartBinIndex";
      msg: "Invalid start bin index";
    },
    {
      code: 6001;
      name: "invalidBinId";
      msg: "Invalid bin id";
    },
    {
      code: 6002;
      name: "invalidInput";
      msg: "Invalid input data";
    },
    {
      code: 6003;
      name: "exceededAmountSlippageTolerance";
      msg: "Exceeded amount slippage tolerance";
    },
    {
      code: 6004;
      name: "exceededBinSlippageTolerance";
      msg: "Exceeded bin slippage tolerance";
    },
    {
      code: 6005;
      name: "compositionFactorFlawed";
      msg: "Composition factor flawed";
    },
    {
      code: 6006;
      name: "nonPresetBinStep";
      msg: "Non preset bin step";
    },
    {
      code: 6007;
      name: "zeroLiquidity";
      msg: "Zero liquidity";
    },
    {
      code: 6008;
      name: "invalidPosition";
      msg: "Invalid position";
    },
    {
      code: 6009;
      name: "binArrayNotFound";
      msg: "Bin array not found";
    },
    {
      code: 6010;
      name: "invalidTokenMint";
      msg: "Invalid token mint";
    },
    {
      code: 6011;
      name: "invalidAccountForSingleDeposit";
      msg: "Invalid account for single deposit";
    },
    {
      code: 6012;
      name: "pairInsufficientLiquidity";
      msg: "Pair insufficient liquidity";
    },
    {
      code: 6013;
      name: "invalidFeeOwner";
      msg: "Invalid fee owner";
    },
    {
      code: 6014;
      name: "invalidFeeWithdrawAmount";
      msg: "Invalid fee withdraw amount";
    },
    {
      code: 6015;
      name: "invalidAdmin";
      msg: "Invalid admin";
    },
    {
      code: 6016;
      name: "identicalFeeOwner";
      msg: "Identical fee owner";
    },
    {
      code: 6017;
      name: "invalidBps";
      msg: "Invalid basis point";
    },
    {
      code: 6018;
      name: "mathOverflow";
      msg: "Math operation overflow";
    },
    {
      code: 6019;
      name: "typeCastFailed";
      msg: "Type cast error";
    },
    {
      code: 6020;
      name: "invalidRewardIndex";
      msg: "Invalid reward index";
    },
    {
      code: 6021;
      name: "invalidRewardDuration";
      msg: "Invalid reward duration";
    },
    {
      code: 6022;
      name: "rewardInitialized";
      msg: "Reward already initialized";
    },
    {
      code: 6023;
      name: "rewardUninitialized";
      msg: "Reward not initialized";
    },
    {
      code: 6024;
      name: "identicalFunder";
      msg: "Identical funder";
    },
    {
      code: 6025;
      name: "rewardCampaignInProgress";
      msg: "Reward campaign in progress";
    },
    {
      code: 6026;
      name: "identicalRewardDuration";
      msg: "Reward duration is the same";
    },
    {
      code: 6027;
      name: "invalidBinArray";
      msg: "Invalid bin array";
    },
    {
      code: 6028;
      name: "nonContinuousBinArrays";
      msg: "Bin arrays must be continuous";
    },
    {
      code: 6029;
      name: "invalidRewardVault";
      msg: "Invalid reward vault";
    },
    {
      code: 6030;
      name: "nonEmptyPosition";
      msg: "Position is not empty";
    },
    {
      code: 6031;
      name: "unauthorizedAccess";
      msg: "Unauthorized access";
    },
    {
      code: 6032;
      name: "invalidFeeParameter";
      msg: "Invalid fee parameter";
    },
    {
      code: 6033;
      name: "missingOracle";
      msg: "Missing oracle account";
    },
    {
      code: 6034;
      name: "insufficientSample";
      msg: "Insufficient observation sample";
    },
    {
      code: 6035;
      name: "invalidLookupTimestamp";
      msg: "Invalid lookup timestamp";
    },
    {
      code: 6036;
      name: "bitmapExtensionAccountIsNotProvided";
      msg: "Bitmap extension account is not provided";
    },
    {
      code: 6037;
      name: "cannotFindNonZeroLiquidityBinArrayId";
      msg: "Cannot find non-zero liquidity binArrayId";
    },
    {
      code: 6038;
      name: "binIdOutOfBound";
      msg: "Bin id out of bound";
    },
    {
      code: 6039;
      name: "insufficientOutAmount";
      msg: "Insufficient amount in for minimum out";
    },
    {
      code: 6040;
      name: "invalidPositionWidth";
      msg: "Invalid position width";
    },
    {
      code: 6041;
      name: "excessiveFeeUpdate";
      msg: "Excessive fee update";
    },
    {
      code: 6042;
      name: "poolDisabled";
      msg: "Pool disabled";
    },
    {
      code: 6043;
      name: "invalidPoolType";
      msg: "Invalid pool type";
    },
    {
      code: 6044;
      name: "exceedMaxWhitelist";
      msg: "Whitelist for wallet is full";
    },
    {
      code: 6045;
      name: "invalidIndex";
      msg: "Invalid index";
    },
    {
      code: 6046;
      name: "rewardNotEnded";
      msg: "Reward not ended";
    },
    {
      code: 6047;
      name: "mustWithdrawnIneligibleReward";
      msg: "Must withdraw ineligible reward";
    },
    {
      code: 6048;
      name: "unauthorizedAddress";
      msg: "Unauthorized address";
    },
    {
      code: 6049;
      name: "operatorsAreTheSame";
      msg: "Cannot update because operators are the same";
    },
    {
      code: 6050;
      name: "withdrawToWrongTokenAccount";
      msg: "Withdraw to wrong token account";
    },
    {
      code: 6051;
      name: "wrongRentReceiver";
      msg: "Wrong rent receiver";
    },
    {
      code: 6052;
      name: "alreadyPassActivationPoint";
      msg: "Already activated";
    },
    {
      code: 6053;
      name: "exceedMaxSwappedAmount";
      msg: "Swapped amount is exceeded max swapped amount";
    },
    {
      code: 6054;
      name: "invalidStrategyParameters";
      msg: "Invalid strategy parameters";
    },
    {
      code: 6055;
      name: "liquidityLocked";
      msg: "Liquidity locked";
    },
    {
      code: 6056;
      name: "binRangeIsNotEmpty";
      msg: "Bin range is not empty";
    },
    {
      code: 6057;
      name: "notExactAmountOut";
      msg: "Amount out is not matched with exact amount out";
    },
    {
      code: 6058;
      name: "invalidActivationType";
      msg: "Invalid activation type";
    },
    {
      code: 6059;
      name: "invalidActivationDuration";
      msg: "Invalid activation duration";
    },
    {
      code: 6060;
      name: "missingTokenAmountAsTokenLaunchProof";
      msg: "Missing token amount as token launch owner proof";
    },
    {
      code: 6061;
      name: "invalidQuoteToken";
      msg: "Quote token must be SOL or USDC";
    },
    {
      code: 6062;
      name: "invalidBinStep";
      msg: "Invalid bin step";
    },
    {
      code: 6063;
      name: "invalidBaseFee";
      msg: "Invalid base fee";
    },
    {
      code: 6064;
      name: "invalidPreActivationDuration";
      msg: "Invalid pre-activation duration";
    },
    {
      code: 6065;
      name: "alreadyPassPreActivationSwapPoint";
      msg: "Already pass pre-activation swap point";
    },
    {
      code: 6066;
      name: "invalidStatus";
      msg: "Invalid status";
    },
    {
      code: 6067;
      name: "exceededMaxOracleLength";
      msg: "Exceed max oracle length";
    },
    {
      code: 6068;
      name: "invalidMinimumLiquidity";
      msg: "Invalid minimum liquidity";
    },
    {
      code: 6069;
      name: "notSupportMint";
      msg: "Not support token_2022 mint extension";
    },
    {
      code: 6070;
      name: "unsupportedMintExtension";
      msg: "Unsupported mint extension";
    },
    {
      code: 6071;
      name: "unsupportNativeMintToken2022";
      msg: "Unsupported native mint token2022";
    },
    {
      code: 6072;
      name: "unmatchTokenMint";
      msg: "Unmatch token mint";
    },
    {
      code: 6073;
      name: "unsupportedTokenMint";
      msg: "Unsupported token mint";
    },
    {
      code: 6074;
      name: "insufficientRemainingAccounts";
      msg: "Insufficient remaining accounts";
    },
    {
      code: 6075;
      name: "invalidRemainingAccountSlice";
      msg: "Invalid remaining account slice";
    },
    {
      code: 6076;
      name: "duplicatedRemainingAccountTypes";
      msg: "Duplicated remaining account types";
    },
    {
      code: 6077;
      name: "missingRemainingAccountForTransferHook";
      msg: "Missing remaining account for transfer hook";
    },
    {
      code: 6078;
      name: "noTransferHookProgram";
      msg: "Remaining account was passed for transfer hook but there's no hook program";
    },
    {
      code: 6079;
      name: "zeroFundedAmount";
      msg: "Zero funded amount";
    },
    {
      code: 6080;
      name: "invalidSide";
      msg: "Invalid side";
    },
    {
      code: 6081;
      name: "invalidResizeLength";
      msg: "Invalid resize length";
    },
    {
      code: 6082;
      name: "notSupportAtTheMoment";
      msg: "Not support at the moment";
    },
  ];
  types: [
    {
      name: "accountsType";
      type: {
        kind: "enum";
        variants: [
          {
            name: "transferHookX";
          },
          {
            name: "transferHookY";
          },
          {
            name: "transferHookReward";
          },
        ];
      };
    },
    {
      name: "activationType";
      docs: ["Type of the activation"];
      repr: {
        kind: "rust";
      };
      type: {
        kind: "enum";
        variants: [
          {
            name: "slot";
          },
          {
            name: "timestamp";
          },
        ];
      };
    },
    {
      name: "actualBinRange";
      type: {
        kind: "struct";
        fields: [
          {
            name: "minBinId";
            type: "i32";
          },
          {
            name: "maxBinId";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "addLiquidity";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "from";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "amounts";
            type: {
              array: ["u64", 2];
            };
          },
          {
            name: "activeBinId";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "addLiquiditySingleSidePreciseParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "bins";
            type: {
              vec: {
                defined: {
                  name: "compressedBinDepositAmount";
                };
              };
            };
          },
          {
            name: "decompressMultiplier";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "addLiquiditySingleSidePreciseParameter2";
      type: {
        kind: "struct";
        fields: [
          {
            name: "bins";
            type: {
              vec: {
                defined: {
                  name: "compressedBinDepositAmount";
                };
              };
            };
          },
          {
            name: "decompressMultiplier";
            type: "u64";
          },
          {
            name: "maxAmount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "baseFeeParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: ["Base factor for base fee rate"];
            type: "u16";
          },
          {
            name: "baseFeePowerFactor";
            docs: ["Base fee power factor"];
            type: "u8";
          },
        ];
      };
    },
    {
      name: "bin";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountX";
            docs: [
              "Amount of token X in the bin. This already excluded protocol fees.",
            ];
            type: "u64";
          },
          {
            name: "amountY";
            docs: [
              "Amount of token Y in the bin. This already excluded protocol fees.",
            ];
            type: "u64";
          },
          {
            name: "price";
            docs: ["Bin price"];
            type: "u128";
          },
          {
            name: "liquiditySupply";
            docs: [
              "Liquidities of the bin. This is the same as LP mint supply. q-number",
            ];
            type: "u128";
          },
          {
            name: "rewardPerTokenStored";
            docs: ["reward_a_per_token_stored"];
            type: {
              array: ["u128", 2];
            };
          },
          {
            name: "feeAmountXPerTokenStored";
            docs: ["Swap fee amount of token X per liquidity deposited."];
            type: "u128";
          },
          {
            name: "feeAmountYPerTokenStored";
            docs: ["Swap fee amount of token Y per liquidity deposited."];
            type: "u128";
          },
          {
            name: "amountXIn";
            docs: [
              "Total token X swap into the bin. Only used for tracking purpose.",
            ];
            type: "u128";
          },
          {
            name: "amountYIn";
            docs: [
              "Total token Y swap into he bin. Only used for tracking purpose.",
            ];
            type: "u128";
          },
        ];
      };
    },
    {
      name: "binArray";
      docs: [
        "An account to contain a range of bin. For example: Bin 100 <-> 200.",
        "For example:",
        "BinArray index: 0 contains bin 0 <-> 599",
        "index: 2 contains bin 600 <-> 1199, ...",
      ];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            type: "i64";
          },
          {
            name: "version";
            docs: ["Version of binArray"];
            type: "u8";
          },
          {
            name: "padding";
            type: {
              array: ["u8", 7];
            };
          },
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "bins";
            type: {
              array: [
                {
                  defined: {
                    name: "bin";
                  };
                },
                70,
              ];
            };
          },
        ];
      };
    },
    {
      name: "binArrayBitmapExtension";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "positiveBinArrayBitmap";
            docs: [
              "Packed initialized bin array state for start_bin_index is positive",
            ];
            type: {
              array: [
                {
                  array: ["u64", 8];
                },
                12,
              ];
            };
          },
          {
            name: "negativeBinArrayBitmap";
            docs: [
              "Packed initialized bin array state for start_bin_index is negative",
            ];
            type: {
              array: [
                {
                  array: ["u64", 8];
                },
                12,
              ];
            };
          },
        ];
      };
    },
    {
      name: "binLiquidityDistribution";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binId";
            docs: ["Define the bin ID wish to deposit to."];
            type: "i32";
          },
          {
            name: "distributionX";
            docs: [
              "DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.",
            ];
            type: "u16";
          },
          {
            name: "distributionY";
            docs: [
              "DistributionX (or distributionY) is the percentages of amountX (or amountY) you want to add to each bin.",
            ];
            type: "u16";
          },
        ];
      };
    },
    {
      name: "binLiquidityDistributionByWeight";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binId";
            docs: ["Define the bin ID wish to deposit to."];
            type: "i32";
          },
          {
            name: "weight";
            docs: ["weight of liquidity distributed for this bin id"];
            type: "u16";
          },
        ];
      };
    },
    {
      name: "binLiquidityReduction";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binId";
            type: "i32";
          },
          {
            name: "bpsToRemove";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "claimFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "feeX";
            type: "u64";
          },
          {
            name: "feeY";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "claimFeeOperator";
      docs: ["Parameter that set by the protocol"];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "operator";
            docs: ["operator"];
            type: "pubkey";
          },
          {
            name: "padding";
            docs: ["Reserve"];
            type: {
              array: ["u8", 128];
            };
          },
        ];
      };
    },
    {
      name: "claimReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u64";
          },
          {
            name: "totalReward";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "compositionFee";
      type: {
        kind: "struct";
        fields: [
          {
            name: "from";
            type: "pubkey";
          },
          {
            name: "binId";
            type: "i16";
          },
          {
            name: "tokenXFeeAmount";
            type: "u64";
          },
          {
            name: "tokenYFeeAmount";
            type: "u64";
          },
          {
            name: "protocolTokenXFeeAmount";
            type: "u64";
          },
          {
            name: "protocolTokenYFeeAmount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "compressedBinDepositAmount";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binId";
            type: "i32";
          },
          {
            name: "amount";
            type: "u32";
          },
        ];
      };
    },
    {
      name: "customizableParams";
      type: {
        kind: "struct";
        fields: [
          {
            name: "activeId";
            docs: ["Pool price"];
            type: "i32";
          },
          {
            name: "binStep";
            docs: ["Bin step"];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: ["Base factor"];
            type: "u16";
          },
          {
            name: "activationType";
            docs: [
              "Activation type. 0 = Slot, 1 = Time. Check ActivationType enum",
            ];
            type: "u8";
          },
          {
            name: "hasAlphaVault";
            docs: ["Whether the pool has an alpha vault"];
            type: "bool";
          },
          {
            name: "activationPoint";
            docs: ["Decide when does the pool start trade. None = Now"];
            type: {
              option: "u64";
            };
          },
          {
            name: "creatorPoolOnOffControl";
            docs: [
              "Pool creator have permission to enable/disable pool with restricted program validation. Only applicable for customizable permissionless pool.",
            ];
            type: "bool";
          },
          {
            name: "baseFeePowerFactor";
            docs: ["Base fee power factor"];
            type: "u8";
          },
          {
            name: "padding";
            docs: ["Padding, for future use"];
            type: {
              array: ["u8", 62];
            };
          },
        ];
      };
    },
    {
      name: "decreasePositionLength";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "lengthToRemove";
            type: "u16";
          },
          {
            name: "side";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "dummyIx";
      type: {
        kind: "struct";
        fields: [
          {
            name: "pairStatus";
            type: {
              defined: {
                name: "pairStatus";
              };
            };
          },
          {
            name: "pairType";
            type: {
              defined: {
                name: "pairType";
              };
            };
          },
          {
            name: "activationType";
            type: {
              defined: {
                name: "activationType";
              };
            };
          },
          {
            name: "tokenProgramFlag";
            type: {
              defined: {
                name: "tokenProgramFlags";
              };
            };
          },
          {
            name: "resizeSide";
            type: {
              defined: {
                name: "resizeSide";
              };
            };
          },
          {
            name: "rounding";
            type: {
              defined: {
                name: "rounding";
              };
            };
          },
        ];
      };
    },
    {
      name: "dummyZcAccount";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "positionBinData";
            type: {
              defined: {
                name: "positionBinData";
              };
            };
          },
        ];
      };
    },
    {
      name: "dynamicFeeParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
        ];
      };
    },
    {
      name: "dynamicFeeParameterUpdate";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
        ];
      };
    },
    {
      name: "feeInfo";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "feeXPerTokenComplete";
            type: "u128";
          },
          {
            name: "feeYPerTokenComplete";
            type: "u128";
          },
          {
            name: "feeXPending";
            type: "u64";
          },
          {
            name: "feeYPending";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "feeParameterUpdate";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "protocolShare";
            type: "u16";
          },
          {
            name: "baseFactor";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "fundReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "funder";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u64";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "goToABin";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "fromBinId";
            type: "i32";
          },
          {
            name: "toBinId";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "increaseObservation";
      type: {
        kind: "struct";
        fields: [
          {
            name: "oracle";
            type: "pubkey";
          },
          {
            name: "newObservationLength";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "increasePositionLength";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
          {
            name: "lengthToAdd";
            type: "u16";
          },
          {
            name: "side";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "initPermissionPairIx";
      type: {
        kind: "struct";
        fields: [
          {
            name: "activeId";
            type: "i32";
          },
          {
            name: "binStep";
            type: "u16";
          },
          {
            name: "baseFactor";
            type: "u16";
          },
          {
            name: "baseFeePowerFactor";
            type: "u8";
          },
          {
            name: "activationType";
            type: "u8";
          },
          {
            name: "protocolShare";
            type: "u16";
          },
        ];
      };
    },
    {
      name: "initPresetParameters2Ix";
      type: {
        kind: "struct";
        fields: [
          {
            name: "index";
            type: "u16";
          },
          {
            name: "binStep";
            docs: ["Bin step. Represent the price increment / decrement."];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: [
              "Used for base fee calculation. base_fee_rate = base_factor * bin_step * 10 * 10^base_fee_power_factor",
            ];
            type: "u16";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
          {
            name: "baseFeePowerFactor";
            docs: ["Base fee power factor"];
            type: "u8";
          },
        ];
      };
    },
    {
      name: "initPresetParametersIx";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binStep";
            docs: ["Bin step. Represent the price increment / decrement."];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: [
              "Used for base fee calculation. base_fee_rate = base_factor * bin_step * 10 * 10^base_fee_power_factor",
            ];
            type: "u16";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
        ];
      };
    },
    {
      name: "initializeLbPair2Params";
      type: {
        kind: "struct";
        fields: [
          {
            name: "activeId";
            docs: ["Pool price"];
            type: "i32";
          },
          {
            name: "padding";
            docs: ["Padding, for future use"];
            type: {
              array: ["u8", 96];
            };
          },
        ];
      };
    },
    {
      name: "initializeReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "rewardMint";
            type: "pubkey";
          },
          {
            name: "funder";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u64";
          },
          {
            name: "rewardDuration";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "lbPair";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "parameters";
            type: {
              defined: {
                name: "staticParameters";
              };
            };
          },
          {
            name: "vParameters";
            type: {
              defined: {
                name: "variableParameters";
              };
            };
          },
          {
            name: "bumpSeed";
            type: {
              array: ["u8", 1];
            };
          },
          {
            name: "binStepSeed";
            docs: ["Bin step signer seed"];
            type: {
              array: ["u8", 2];
            };
          },
          {
            name: "pairType";
            docs: ["Type of the pair"];
            type: "u8";
          },
          {
            name: "activeId";
            docs: ["Active bin id"];
            type: "i32";
          },
          {
            name: "binStep";
            docs: ["Bin step. Represent the price increment / decrement."];
            type: "u16";
          },
          {
            name: "status";
            docs: ["Status of the pair. Check PairStatus enum."];
            type: "u8";
          },
          {
            name: "requireBaseFactorSeed";
            docs: ["Require base factor seed"];
            type: "u8";
          },
          {
            name: "baseFactorSeed";
            docs: ["Base factor seed"];
            type: {
              array: ["u8", 2];
            };
          },
          {
            name: "activationType";
            docs: ["Activation type"];
            type: "u8";
          },
          {
            name: "creatorPoolOnOffControl";
            docs: [
              "Allow pool creator to enable/disable pool with restricted validation. Only applicable for customizable permissionless pair type.",
            ];
            type: "u8";
          },
          {
            name: "tokenXMint";
            docs: ["Token X mint"];
            type: "pubkey";
          },
          {
            name: "tokenYMint";
            docs: ["Token Y mint"];
            type: "pubkey";
          },
          {
            name: "reserveX";
            docs: ["LB token X vault"];
            type: "pubkey";
          },
          {
            name: "reserveY";
            docs: ["LB token Y vault"];
            type: "pubkey";
          },
          {
            name: "protocolFee";
            docs: ["Uncollected protocol fee"];
            type: {
              defined: {
                name: "protocolFee";
              };
            };
          },
          {
            name: "padding1";
            docs: [
              "_padding_1, previous Fee owner, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!",
            ];
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "rewardInfos";
            docs: ["Farming reward information"];
            type: {
              array: [
                {
                  defined: {
                    name: "rewardInfo";
                  };
                },
                2,
              ];
            };
          },
          {
            name: "oracle";
            docs: ["Oracle pubkey"];
            type: "pubkey";
          },
          {
            name: "binArrayBitmap";
            docs: ["Packed initialized bin array state"];
            type: {
              array: ["u64", 16];
            };
          },
          {
            name: "lastUpdatedAt";
            docs: ["Last time the pool fee parameter was updated"];
            type: "i64";
          },
          {
            name: "padding2";
            docs: [
              "_padding_2, previous whitelisted_wallet, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!",
            ];
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "preActivationSwapAddress";
            docs: [
              "Address allowed to swap when the current point is greater than or equal to the pre-activation point. The pre-activation point is calculated as `activation_point - pre_activation_duration`.",
            ];
            type: "pubkey";
          },
          {
            name: "baseKey";
            docs: ["Base keypair. Only required for permission pair"];
            type: "pubkey";
          },
          {
            name: "activationPoint";
            docs: [
              "Time point to enable the pair. Only applicable for permission pair.",
            ];
            type: "u64";
          },
          {
            name: "preActivationDuration";
            docs: [
              "Duration before activation activation_point. Used to calculate pre-activation time point for pre_activation_swap_address",
            ];
            type: "u64";
          },
          {
            name: "padding3";
            docs: [
              "_padding 3 is reclaimed free space from swap_cap_deactivate_point and swap_cap_amount before, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!",
            ];
            type: {
              array: ["u8", 8];
            };
          },
          {
            name: "padding4";
            docs: [
              "_padding_4, previous lock_duration, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!",
            ];
            type: "u64";
          },
          {
            name: "creator";
            docs: ["Pool creator"];
            type: "pubkey";
          },
          {
            name: "tokenMintXProgramFlag";
            docs: ["tokenMintXProgramFlag"];
            type: "u8";
          },
          {
            name: "tokenMintYProgramFlag";
            docs: ["tokenMintYProgramFlag"];
            type: "u8";
          },
          {
            name: "reserved";
            docs: ["Reserved space for future use"];
            type: {
              array: ["u8", 22];
            };
          },
        ];
      };
    },
    {
      name: "lbPairCreate";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "binStep";
            type: "u16";
          },
          {
            name: "tokenX";
            type: "pubkey";
          },
          {
            name: "tokenY";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "liquidityOneSideParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amount";
            docs: ["Amount of X token or Y token to deposit"];
            type: "u64";
          },
          {
            name: "activeId";
            docs: ["Active bin that integrator observe off-chain"];
            type: "i32";
          },
          {
            name: "maxActiveBinSlippage";
            docs: ["max active bin slippage allowed"];
            type: "i32";
          },
          {
            name: "binLiquidityDist";
            docs: ["Liquidity distribution to each bins"];
            type: {
              vec: {
                defined: {
                  name: "binLiquidityDistributionByWeight";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "liquidityParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountX";
            docs: ["Amount of X token to deposit"];
            type: "u64";
          },
          {
            name: "amountY";
            docs: ["Amount of Y token to deposit"];
            type: "u64";
          },
          {
            name: "binLiquidityDist";
            docs: ["Liquidity distribution to each bins"];
            type: {
              vec: {
                defined: {
                  name: "binLiquidityDistribution";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "liquidityParameterByStrategy";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountX";
            docs: ["Amount of X token to deposit"];
            type: "u64";
          },
          {
            name: "amountY";
            docs: ["Amount of Y token to deposit"];
            type: "u64";
          },
          {
            name: "activeId";
            docs: ["Active bin that integrator observe off-chain"];
            type: "i32";
          },
          {
            name: "maxActiveBinSlippage";
            docs: ["max active bin slippage allowed"];
            type: "i32";
          },
          {
            name: "strategyParameters";
            docs: ["strategy parameters"];
            type: {
              defined: {
                name: "strategyParameters";
              };
            };
          },
        ];
      };
    },
    {
      name: "liquidityParameterByStrategyOneSide";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amount";
            docs: ["Amount of X token or Y token to deposit"];
            type: "u64";
          },
          {
            name: "activeId";
            docs: ["Active bin that integrator observe off-chain"];
            type: "i32";
          },
          {
            name: "maxActiveBinSlippage";
            docs: ["max active bin slippage allowed"];
            type: "i32";
          },
          {
            name: "strategyParameters";
            docs: ["strategy parameters"];
            type: {
              defined: {
                name: "strategyParameters";
              };
            };
          },
        ];
      };
    },
    {
      name: "liquidityParameterByWeight";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountX";
            docs: ["Amount of X token to deposit"];
            type: "u64";
          },
          {
            name: "amountY";
            docs: ["Amount of Y token to deposit"];
            type: "u64";
          },
          {
            name: "activeId";
            docs: ["Active bin that integrator observe off-chain"];
            type: "i32";
          },
          {
            name: "maxActiveBinSlippage";
            docs: ["max active bin slippage allowed"];
            type: "i32";
          },
          {
            name: "binLiquidityDist";
            docs: ["Liquidity distribution to each bins"];
            type: {
              vec: {
                defined: {
                  name: "binLiquidityDistributionByWeight";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "oracle";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "idx";
            docs: ["Index of latest observation"];
            type: "u64";
          },
          {
            name: "activeSize";
            docs: [
              "Size of active sample. Active sample is initialized observation.",
            ];
            type: "u64";
          },
          {
            name: "length";
            docs: ["Number of observations"];
            type: "u64";
          },
        ];
      };
    },
    {
      name: "pairStatus";
      docs: [
        "Pair status. 0 = Enabled, 1 = Disabled. Putting 0 as enabled for backward compatibility.",
      ];
      repr: {
        kind: "rust";
      };
      type: {
        kind: "enum";
        variants: [
          {
            name: "enabled";
          },
          {
            name: "disabled";
          },
        ];
      };
    },
    {
      name: "pairType";
      docs: [
        "Type of the Pair. 0 = Permissionless, 1 = Permission, 2 = CustomizablePermissionless. Putting 0 as permissionless for backward compatibility.",
      ];
      repr: {
        kind: "rust";
      };
      type: {
        kind: "enum";
        variants: [
          {
            name: "permissionless";
          },
          {
            name: "permission";
          },
          {
            name: "customizablePermissionless";
          },
          {
            name: "permissionlessV2";
          },
        ];
      };
    },
    {
      name: "position";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            docs: ["The LB pair of this position"];
            type: "pubkey";
          },
          {
            name: "owner";
            docs: [
              "Owner of the position. Client rely on this to to fetch their positions.",
            ];
            type: "pubkey";
          },
          {
            name: "liquidityShares";
            docs: [
              "Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.",
            ];
            type: {
              array: ["u64", 70];
            };
          },
          {
            name: "rewardInfos";
            docs: ["Farming reward information"];
            type: {
              array: [
                {
                  defined: {
                    name: "userRewardInfo";
                  };
                },
                70,
              ];
            };
          },
          {
            name: "feeInfos";
            docs: ["Swap fee to claim information"];
            type: {
              array: [
                {
                  defined: {
                    name: "feeInfo";
                  };
                },
                70,
              ];
            };
          },
          {
            name: "lowerBinId";
            docs: ["Lower bin ID"];
            type: "i32";
          },
          {
            name: "upperBinId";
            docs: ["Upper bin ID"];
            type: "i32";
          },
          {
            name: "lastUpdatedAt";
            docs: ["Last updated timestamp"];
            type: "i64";
          },
          {
            name: "totalClaimedFeeXAmount";
            docs: ["Total claimed token fee X"];
            type: "u64";
          },
          {
            name: "totalClaimedFeeYAmount";
            docs: ["Total claimed token fee Y"];
            type: "u64";
          },
          {
            name: "totalClaimedRewards";
            docs: ["Total claimed rewards"];
            type: {
              array: ["u64", 2];
            };
          },
          {
            name: "reserved";
            docs: ["Reserved space for future use"];
            type: {
              array: ["u8", 160];
            };
          },
        ];
      };
    },
    {
      name: "positionBinData";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "liquidityShare";
            type: "u128";
          },
          {
            name: "rewardInfo";
            type: {
              defined: {
                name: "userRewardInfo";
              };
            };
          },
          {
            name: "feeInfo";
            type: {
              defined: {
                name: "feeInfo";
              };
            };
          },
        ];
      };
    },
    {
      name: "positionClose";
      type: {
        kind: "struct";
        fields: [
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "positionCreate";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "owner";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "positionV2";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            docs: ["The LB pair of this position"];
            type: "pubkey";
          },
          {
            name: "owner";
            docs: [
              "Owner of the position. Client rely on this to to fetch their positions.",
            ];
            type: "pubkey";
          },
          {
            name: "liquidityShares";
            docs: [
              "Liquidity shares of this position in bins (lower_bin_id <-> upper_bin_id). This is the same as LP concept.",
            ];
            type: {
              array: ["u128", 70];
            };
          },
          {
            name: "rewardInfos";
            docs: ["Farming reward information"];
            type: {
              array: [
                {
                  defined: {
                    name: "userRewardInfo";
                  };
                },
                70,
              ];
            };
          },
          {
            name: "feeInfos";
            docs: ["Swap fee to claim information"];
            type: {
              array: [
                {
                  defined: {
                    name: "feeInfo";
                  };
                },
                70,
              ];
            };
          },
          {
            name: "lowerBinId";
            docs: ["Lower bin ID"];
            type: "i32";
          },
          {
            name: "upperBinId";
            docs: ["Upper bin ID"];
            type: "i32";
          },
          {
            name: "lastUpdatedAt";
            docs: ["Last updated timestamp"];
            type: "i64";
          },
          {
            name: "totalClaimedFeeXAmount";
            docs: ["Total claimed token fee X"];
            type: "u64";
          },
          {
            name: "totalClaimedFeeYAmount";
            docs: ["Total claimed token fee Y"];
            type: "u64";
          },
          {
            name: "totalClaimedRewards";
            docs: ["Total claimed rewards"];
            type: {
              array: ["u64", 2];
            };
          },
          {
            name: "operator";
            docs: ["Operator of position"];
            type: "pubkey";
          },
          {
            name: "lockReleasePoint";
            docs: ["Time point which the locked liquidity can be withdraw"];
            type: "u64";
          },
          {
            name: "padding0";
            docs: [
              "_padding_0, previous subjected_to_bootstrap_liquidity_locking, BE CAREFUL FOR TOMBSTONE WHEN REUSE !!",
            ];
            type: "u8";
          },
          {
            name: "feeOwner";
            docs: [
              "Address is able to claim fee in this position, only valid for bootstrap_liquidity_position",
            ];
            type: "pubkey";
          },
          {
            name: "reserved";
            docs: ["Reserved space for future use"];
            type: {
              array: ["u8", 87];
            };
          },
        ];
      };
    },
    {
      name: "presetParameter";
      type: {
        kind: "struct";
        fields: [
          {
            name: "binStep";
            docs: ["Bin step. Represent the price increment / decrement."];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: [
              "Used for base fee calculation. base_fee_rate = base_factor * bin_step * 10 * 10^base_fee_power_factor",
            ];
            type: "u16";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
          {
            name: "minBinId";
            docs: [
              "Min bin id supported by the pool based on the configured bin step.",
            ];
            type: "i32";
          },
          {
            name: "maxBinId";
            docs: [
              "Max bin id supported by the pool based on the configured bin step.",
            ];
            type: "i32";
          },
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
        ];
      };
    },
    {
      name: "presetParameter2";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "binStep";
            docs: ["Bin step. Represent the price increment / decrement."];
            type: "u16";
          },
          {
            name: "baseFactor";
            docs: [
              "Used for base fee calculation. base_fee_rate = base_factor * bin_step * 10 * 10^base_fee_power_factor",
            ];
            type: "u16";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
          {
            name: "index";
            docs: ["index"];
            type: "u16";
          },
          {
            name: "baseFeePowerFactor";
            docs: ["Base fee power factor"];
            type: "u8";
          },
          {
            name: "padding0";
            docs: ["Padding 0 for future use"];
            type: "u8";
          },
          {
            name: "padding1";
            docs: ["Padding 1 for future use"];
            type: {
              array: ["u64", 20];
            };
          },
        ];
      };
    },
    {
      name: "protocolFee";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "amountX";
            type: "u64";
          },
          {
            name: "amountY";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "remainingAccountsInfo";
      type: {
        kind: "struct";
        fields: [
          {
            name: "slices";
            type: {
              vec: {
                defined: {
                  name: "remainingAccountsSlice";
                };
              };
            };
          },
        ];
      };
    },
    {
      name: "remainingAccountsSlice";
      type: {
        kind: "struct";
        fields: [
          {
            name: "accountsType";
            type: {
              defined: {
                name: "accountsType";
              };
            };
          },
          {
            name: "length";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "removeLiquidity";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "from";
            type: "pubkey";
          },
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "amounts";
            type: {
              array: ["u64", 2];
            };
          },
          {
            name: "activeBinId";
            type: "i32";
          },
        ];
      };
    },
    {
      name: "resizeSide";
      docs: ["Side of resize, 0 for lower and 1 for upper"];
      repr: {
        kind: "rust";
      };
      type: {
        kind: "enum";
        variants: [
          {
            name: "lower";
          },
          {
            name: "upper";
          },
        ];
      };
    },
    {
      name: "rewardInfo";
      docs: ["Stores the state relevant for tracking liquidity mining rewards"];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "mint";
            docs: ["Reward token mint."];
            type: "pubkey";
          },
          {
            name: "vault";
            docs: ["Reward vault token account."];
            type: "pubkey";
          },
          {
            name: "funder";
            docs: ["Authority account that allows to fund rewards"];
            type: "pubkey";
          },
          {
            name: "rewardDuration";
            docs: ["TODO check whether we need to store it in pool"];
            type: "u64";
          },
          {
            name: "rewardDurationEnd";
            docs: ["TODO check whether we need to store it in pool"];
            type: "u64";
          },
          {
            name: "rewardRate";
            docs: ["TODO check whether we need to store it in pool"];
            type: "u128";
          },
          {
            name: "lastUpdateTime";
            docs: ["The last time reward states were updated."];
            type: "u64";
          },
          {
            name: "cumulativeSecondsWithEmptyLiquidityReward";
            docs: [
              "Accumulated seconds where when farm distribute rewards, but the bin is empty. The reward will be accumulated for next reward time window.",
            ];
            type: "u64";
          },
        ];
      };
    },
    {
      name: "rounding";
      type: {
        kind: "enum";
        variants: [
          {
            name: "up";
          },
          {
            name: "down";
          },
        ];
      };
    },
    {
      name: "staticParameters";
      docs: ["Parameter that set by the protocol"];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "baseFactor";
            docs: [
              "Used for base fee calculation. base_fee_rate = base_factor * bin_step * 10 * 10^base_fee_power_factor",
            ];
            type: "u16";
          },
          {
            name: "filterPeriod";
            docs: [
              "Filter period determine high frequency trading time window.",
            ];
            type: "u16";
          },
          {
            name: "decayPeriod";
            docs: [
              "Decay period determine when the volatile fee start decay / decrease.",
            ];
            type: "u16";
          },
          {
            name: "reductionFactor";
            docs: [
              "Reduction factor controls the volatile fee rate decrement rate.",
            ];
            type: "u16";
          },
          {
            name: "variableFeeControl";
            docs: [
              "Used to scale the variable fee component depending on the dynamic of the market",
            ];
            type: "u32";
          },
          {
            name: "maxVolatilityAccumulator";
            docs: [
              "Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.",
            ];
            type: "u32";
          },
          {
            name: "minBinId";
            docs: [
              "Min bin id supported by the pool based on the configured bin step.",
            ];
            type: "i32";
          },
          {
            name: "maxBinId";
            docs: [
              "Max bin id supported by the pool based on the configured bin step.",
            ];
            type: "i32";
          },
          {
            name: "protocolShare";
            docs: [
              "Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee",
            ];
            type: "u16";
          },
          {
            name: "baseFeePowerFactor";
            docs: ["Base fee power factor"];
            type: "u8";
          },
          {
            name: "padding";
            docs: ["Padding for bytemuck safe alignment"];
            type: {
              array: ["u8", 5];
            };
          },
        ];
      };
    },
    {
      name: "strategyParameters";
      type: {
        kind: "struct";
        fields: [
          {
            name: "minBinId";
            docs: ["min bin id"];
            type: "i32";
          },
          {
            name: "maxBinId";
            docs: ["max bin id"];
            type: "i32";
          },
          {
            name: "strategyType";
            docs: ["strategy type"];
            type: {
              defined: {
                name: "strategyType";
              };
            };
          },
          {
            name: "favorSide";
            docs: ["favor ask/bid side, 0 for bin side, 1 for ask side"];
            type: "u8";
          },
          {
            name: "actualBinRange";
            docs: ["actual bin range"];
            type: {
              option: {
                defined: {
                  name: "actualBinRange";
                };
              };
            };
          },
          {
            name: "parameteres";
            type: {
              array: ["u8", 54];
            };
          },
        ];
      };
    },
    {
      name: "strategyType";
      type: {
        kind: "enum";
        variants: [
          {
            name: "spotOneSide";
          },
          {
            name: "curveOneSide";
          },
          {
            name: "bidAskOneSide";
          },
          {
            name: "spotBalanced";
          },
          {
            name: "curveBalanced";
          },
          {
            name: "bidAskBalanced";
          },
          {
            name: "spotImBalanced";
          },
          {
            name: "curveImBalanced";
          },
          {
            name: "bidAskImBalanced";
          },
        ];
      };
    },
    {
      name: "swap";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "from";
            type: "pubkey";
          },
          {
            name: "startBinId";
            type: "i32";
          },
          {
            name: "endBinId";
            type: "i32";
          },
          {
            name: "amountIn";
            type: "u64";
          },
          {
            name: "amountOut";
            type: "u64";
          },
          {
            name: "swapForY";
            type: "bool";
          },
          {
            name: "fee";
            type: "u64";
          },
          {
            name: "protocolFee";
            type: "u64";
          },
          {
            name: "feeBps";
            type: "u128";
          },
          {
            name: "hostFee";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "tokenBadge";
      docs: ["Parameter that set by the protocol"];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "tokenMint";
            docs: ["token mint"];
            type: "pubkey";
          },
          {
            name: "padding";
            docs: ["Reserve"];
            type: {
              array: ["u8", 128];
            };
          },
        ];
      };
    },
    {
      name: "tokenProgramFlags";
      repr: {
        kind: "rust";
      };
      type: {
        kind: "enum";
        variants: [
          {
            name: "tokenProgram";
          },
          {
            name: "tokenProgram2022";
          },
        ];
      };
    },
    {
      name: "updatePositionLockReleasePoint";
      type: {
        kind: "struct";
        fields: [
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "currentPoint";
            type: "u64";
          },
          {
            name: "newLockReleasePoint";
            type: "u64";
          },
          {
            name: "oldLockReleasePoint";
            type: "u64";
          },
          {
            name: "sender";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "updatePositionOperator";
      type: {
        kind: "struct";
        fields: [
          {
            name: "position";
            type: "pubkey";
          },
          {
            name: "oldOperator";
            type: "pubkey";
          },
          {
            name: "newOperator";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "updateRewardDuration";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u64";
          },
          {
            name: "oldRewardDuration";
            type: "u64";
          },
          {
            name: "newRewardDuration";
            type: "u64";
          },
        ];
      };
    },
    {
      name: "updateRewardFunder";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "rewardIndex";
            type: "u64";
          },
          {
            name: "oldFunder";
            type: "pubkey";
          },
          {
            name: "newFunder";
            type: "pubkey";
          },
        ];
      };
    },
    {
      name: "userRewardInfo";
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "rewardPerTokenCompletes";
            type: {
              array: ["u128", 2];
            };
          },
          {
            name: "rewardPendings";
            type: {
              array: ["u64", 2];
            };
          },
        ];
      };
    },
    {
      name: "variableParameters";
      docs: ["Parameters that changes based on dynamic of the market"];
      serialization: "bytemuck";
      repr: {
        kind: "c";
      };
      type: {
        kind: "struct";
        fields: [
          {
            name: "volatilityAccumulator";
            docs: [
              "Volatility accumulator measure the number of bin crossed since reference bin ID. Normally (without filter period taken into consideration), reference bin ID is the active bin of last swap.",
              "It affects the variable fee rate",
            ];
            type: "u32";
          },
          {
            name: "volatilityReference";
            docs: [
              "Volatility reference is decayed volatility accumulator. It is always <= volatility_accumulator",
            ];
            type: "u32";
          },
          {
            name: "indexReference";
            docs: ["Active bin id of last swap."];
            type: "i32";
          },
          {
            name: "padding";
            docs: ["Padding for bytemuck safe alignment"];
            type: {
              array: ["u8", 4];
            };
          },
          {
            name: "lastUpdateTimestamp";
            docs: ["Last timestamp the variable parameters was updated"];
            type: "i64";
          },
          {
            name: "padding1";
            docs: ["Padding for bytemuck safe alignment"];
            type: {
              array: ["u8", 8];
            };
          },
        ];
      };
    },
    {
      name: "withdrawIneligibleReward";
      type: {
        kind: "struct";
        fields: [
          {
            name: "lbPair";
            type: "pubkey";
          },
          {
            name: "rewardMint";
            type: "pubkey";
          },
          {
            name: "amount";
            type: "u64";
          },
        ];
      };
    },
  ];
  constants: [
    {
      name: "basisPointMax";
      type: "i32";
      value: "10000";
    },
    {
      name: "binArray";
      type: "bytes";
      value: "[98, 105, 110, 95, 97, 114, 114, 97, 121]";
    },
    {
      name: "binArrayBitmapSeed";
      type: "bytes";
      value: "[98, 105, 116, 109, 97, 112]";
    },
    {
      name: "binArrayBitmapSize";
      type: "i32";
      value: "512";
    },
    {
      name: "claimProtocolFeeOperator";
      type: "bytes";
      value: "[99, 102, 95, 111, 112, 101, 114, 97, 116, 111, 114]";
    },
    {
      name: "defaultBinPerPosition";
      type: "u64";
      value: "70";
    },
    {
      name: "extensionBinarrayBitmapSize";
      type: "u64";
      value: "12";
    },
    {
      name: "feePrecision";
      type: "u64";
      value: "1000000000";
    },
    {
      name: "hostFeeBps";
      docs: ["Host fee. 20%"];
      type: "u16";
      value: "2000";
    },
    {
      name: "ilmProtocolShare";
      type: "u16";
      value: "2000";
    },
    {
      name: "maxBaseFee";
      docs: ["Maximum base fee, base_fee / 10^9 = fee_in_percentage"];
      type: "u128";
      value: "100000000";
    },
    {
      name: "maxBinId";
      docs: ["Maximum bin ID supported. Computed based on 1 bps."];
      type: "i32";
      value: "443636";
    },
    {
      name: "maxBinPerArray";
      type: "u64";
      value: "70";
    },
    {
      name: "maxBinStep";
      docs: ["Maximum bin step"];
      type: "u16";
      value: "400";
    },
    {
      name: "maxFeeRate";
      docs: ["Maximum fee rate. 10%"];
      type: "u64";
      value: "100000000";
    },
    {
      name: "maxProtocolShare";
      docs: ["Maximum protocol share of the fee. 25%"];
      type: "u16";
      value: "2500";
    },
    {
      name: "maxResizeLength";
      type: "u64";
      value: "70";
    },
    {
      name: "maxRewardBinSplit";
      type: "u64";
      value: "15";
    },
    {
      name: "maxRewardDuration";
      type: "u64";
      value: "31536000";
    },
    {
      name: "minimumLiquidity";
      type: "u128";
      value: "1000000";
    },
    {
      name: "minBaseFee";
      docs: ["Minimum base fee"];
      type: "u128";
      value: "100000";
    },
    {
      name: "minBinId";
      docs: ["Minimum bin ID supported. Computed based on 1 bps."];
      type: "i32";
      value: "-443636";
    },
    {
      name: "minRewardDuration";
      type: "u64";
      value: "1";
    },
    {
      name: "numRewards";
      type: "u64";
      value: "2";
    },
    {
      name: "oracle";
      type: "bytes";
      value: "[111, 114, 97, 99, 108, 101]";
    },
    {
      name: "position";
      type: "bytes";
      value: "[112, 111, 115, 105, 116, 105, 111, 110]";
    },
    {
      name: "positionMaxLength";
      type: "u64";
      value: "1400";
    },
    {
      name: "presetParameter";
      type: "bytes";
      value: "[112, 114, 101, 115, 101, 116, 95, 112, 97, 114, 97, 109, 101, 116, 101, 114]";
    },
    {
      name: "presetParameter2";
      type: "bytes";
      value: "[112, 114, 101, 115, 101, 116, 95, 112, 97, 114, 97, 109, 101, 116, 101, 114, 50]";
    },
    {
      name: "protocolShare";
      type: "u16";
      value: "500";
    },
  ];
};
