use crate::*;
use dlmm_interface::{PositionBinData, PositionV3, PositionV3Account};

// std::mem::size_of is safe because PositionV3 implements bytemuck::Pod
pub const GLOBAL_DATA_SPACE: usize = 8 + std::mem::size_of::<PositionV3>();

#[derive(Debug, Clone)]
pub struct DynamicPosition {
    pub global_data: PositionV3,
    pub position_bin_data: Vec<PositionBinData>,
}

impl DynamicPosition {
    // Same interface as solores
    pub fn deserialize(buf: &[u8]) -> Result<Self> {
        let global_data = PositionV3Account::deserialize(buf)?.0;

        let position_bin_bytes = &buf[GLOBAL_DATA_SPACE..];
        let position_bin_data =
            bytemuck::cast_slice::<u8, PositionBinData>(position_bin_bytes).to_owned();

        Ok(Self {
            global_data,
            position_bin_data,
        })
    }

    pub fn is_empty(&self) -> bool {
        for bin in self.position_bin_data.iter() {
            if bin.liquidity_share > 0 {
                return false;
            }
        }

        true
    }
}
