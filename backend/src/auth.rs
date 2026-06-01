use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Clone)]
pub struct OtpEntry {
    pub code: String,
    pub expires_at: chrono::DateTime<Utc>,
}

#[derive(Default)]
pub struct AuthStore {
    otps: RwLock<HashMap<String, OtpEntry>>,
}

impl AuthStore {
    pub fn issue_otp(&self, mobile: &str) -> String {
        let code = rand::thread_rng().gen_range(100000..999999).to_string();
        let entry = OtpEntry {
            code: code.clone(),
            expires_at: Utc::now() + Duration::minutes(10),
        };
        self.otps
            .write()
            .expect("OTP store poisoned")
            .insert(mobile.to_string(), entry);
        code
    }

    pub fn verify_otp(&self, mobile: &str, code: &str) -> bool {
        let mut otps = self.otps.write().expect("OTP store poisoned");
        if let Some(entry) = otps.get(mobile) {
            if entry.expires_at > Utc::now() && entry.code == code {
                otps.remove(mobile);
                return true;
            }
        }
        false
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
}

pub fn create_jwt(mobile: &str, secret: &str) -> anyhow::Result<String> {
    let expiration = Utc::now() + Duration::hours(8);
    let claims = Claims {
        sub: mobile.to_string(),
        exp: expiration.timestamp() as usize,
    };
    let token = encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_ref()))?;
    Ok(token)
}

pub fn verify_jwt(token: &str, secret: &str) -> anyhow::Result<Claims> {
    let token_data = decode::<Claims>(token, &DecodingKey::from_secret(secret.as_ref()), &Validation::default())?;
    Ok(token_data.claims)
}
