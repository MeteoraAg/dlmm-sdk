#[cfg(not(feature = "staging"))]
solana_program::declare_id!("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");

#[cfg(feature = "staging")]
solana_program::declare_id!("tLBro6JJuZNnpoad3p8pXKohE9f7f7tBZJpaeh6pXt1");

pub mod accounts;
pub use accounts::*;
pub mod typedefs;
pub use typedefs::*;
pub mod instructions;
pub use instructions::*;
pub mod errors;
pub use errors::*;
pub mod events;
pub use events::*;
