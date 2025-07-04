/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/transfer_hook_counter.json`.
 */
export type TransferHookCounter = {
  "address": "abcSyangMHdGzUGKhBhKoQzSFdJKUdkPGf5cbXVHpEw",
  "metadata": {
    "name": "transferHookCounter",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "initializeExtraAccountMetaList",
      "discriminator": [
        92,
        197,
        174,
        197,
        41,
        124,
        19,
        3
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "extraAccountMetaList",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "counterAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram"
        },
        {
          "name": "systemProgram"
        }
      ],
      "args": []
    },
    {
      "name": "transferHook",
      "discriminator": [
        220,
        57,
        220,
        152,
        126,
        125,
        97,
        168
      ],
      "accounts": [
        {
          "name": "sourceToken"
        },
        {
          "name": "mint"
        },
        {
          "name": "destinationToken"
        },
        {
          "name": "owner"
        },
        {
          "name": "extraAccountMetaList"
        },
        {
          "name": "counterAccount",
          "writable": true
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
      "discriminator": [
        164,
        8,
        153,
        71,
        8,
        44,
        93,
        22
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "amountTooBig",
      "msg": "The amount is too big"
    }
  ],
  "types": [
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
  ]
};
