use dlmm_interface::PairType;
use std::ops::Deref;

pub struct PairTypeWrapper(PairType);

impl Deref for PairTypeWrapper {
    type Target = PairType;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<u8> for PairTypeWrapper {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(PairTypeWrapper(PairType::Permissionless)),
            1 => Ok(PairTypeWrapper(PairType::Permission)),
            2 => Ok(PairTypeWrapper(PairType::CustomizablePermissionless)),
            3 => Ok(PairTypeWrapper(PairType::PermissionlessV2)),
            _ => Err(anyhow::anyhow!("Invalid PairType value: {}", value)),
        }
    }
}
