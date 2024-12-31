export type TransferHookCounter = {
  "version": "0.1.0",
  "name": "transfer_hook_counter",
  "instructions": [
    {
      "name": "initializeExtraAccountMetaList",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "extraAccountMetaList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "counterAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferHook",
      "accounts": [
        {
          "name": "sourceToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "destinationToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "extraAccountMetaList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "counterAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "counterAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "counter",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "AmountTooBig",
      "msg": "The amount is too big"
    }
  ]
};

export const IDL: TransferHookCounter = {
  "version": "0.1.0",
  "name": "transfer_hook_counter",
  "instructions": [
    {
      "name": "initializeExtraAccountMetaList",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "extraAccountMetaList",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "counterAccount",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferHook",
      "accounts": [
        {
          "name": "sourceToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "mint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "destinationToken",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "extraAccountMetaList",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "counterAccount",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "counterAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "counter",
            "type": "u32"
          }
        ]
      }
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "AmountTooBig",
      "msg": "The amount is too big"
    }
  ]
};
