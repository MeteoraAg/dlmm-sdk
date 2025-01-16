use dlmm_interface::PairStatus;
use std::ops::Deref;

pub struct PairStatusWrapper(PairStatus);

impl Deref for PairStatusWrapper {
    type Target = PairStatus;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<u8> for PairStatusWrapper {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(PairStatusWrapper(PairStatus::Enabled)),
            1 => Ok(PairStatusWrapper(PairStatus::Disabled)),
            _ => Err(anyhow::anyhow!("Invalid PairStatus value: {}", value)),
        }
    }
}
