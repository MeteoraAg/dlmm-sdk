from typing import List
from solders.hash import Hash
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solana.transaction import Transaction
from solders.instruction import Instruction, AccountMeta

def convert_to_transaction(response: dict) -> Transaction:
    recent_blockhash = Hash.from_string(response["recentBlockhash"])
    fee_payer = Pubkey.from_string(response["feePayer"])

    instructions: List[Instruction] = []
    for instruction in response["instructions"]:
        keys = [AccountMeta(Pubkey.from_string(key["pubkey"]), key["isSigner"], key["isWritable"]) for key in instruction["keys"]]
        data = bytes(instruction['data'])
        program_id = Pubkey.from_string(instruction['programId'])
        compiled_instruction = Instruction(
            program_id=program_id,
            data=data,
            accounts=keys
        )
        instructions.append(compiled_instruction)

    transaction = Transaction(
        recent_blockhash=recent_blockhash, 
        instructions=instructions,
        fee_payer=fee_payer,
    )

    return transaction

