use super::super::errors::ErrorCode;
use anchor_lang::prelude::*;

#[account(zero_copy)]
#[derive(InitSpace)]
pub struct PositionManager {
    pub owner: Pubkey,
    pub lb_pair: Pubkey,
    pub lower_bin_id: i32,
    pub upper_bin_id: i32,
    pub idx: u32,
    pub padding: [u8; 3],
    pub bump: u8,
    pub positions: [Pubkey; 300],
}

impl PositionManager {
    pub fn init(&mut self, owner: Pubkey, lb_pair: Pubkey, bump: u8) {
        self.owner = owner;
        self.lb_pair = lb_pair;
        self.bump = bump;
    }

    pub fn add_position(
        &mut self,
        position: Pubkey,
        lower_bin_id: i32,
        upper_bin_id: i32,
    ) -> Result<()> {
        require!(lower_bin_id < upper_bin_id, ErrorCode::InvalidRange);

        if self.idx == 0 {
            self.lower_bin_id = lower_bin_id;
            self.upper_bin_id = upper_bin_id;
        } else {
            require!(
                lower_bin_id == self.upper_bin_id + 1 || upper_bin_id == self.lower_bin_id - 1,
                ErrorCode::InvalidRange
            );
            if lower_bin_id > self.upper_bin_id {
                self.upper_bin_id = upper_bin_id;
            } else {
                self.lower_bin_id = lower_bin_id;
            }
        }

        self.positions[self.idx as usize] = position;
        self.idx += 1;

        Ok(())
    }
}
