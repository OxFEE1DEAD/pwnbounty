#[cfg(all(target_arch = "wasm32", target_os = "wasi"))]
fn main() {
    if run().is_err() {
        eprintln!("Runner execution failed; no result was returned");
        std::process::exit(1);
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "wasi"))]
fn run() -> sealed_bounty_tee_core::Result<()> {
    use sealed_bounty_tee_core::{
        model::NearAiModel,
        model_attestation::ModelPolicy,
        outlayer::OutLayerEnclave,
        protocol::{hash_field, TargetConfig},
        workflow::{self, SealedReport, VerifyRequest},
    };
    use serde::Deserialize;
    use std::io::{Read, Write};

    #[derive(Deserialize)]
    #[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
    enum Input {
        Provision,
        Verify {
            report: SealedReport,
            config: TargetConfig,
            sealed_state: String,
        },
    }
    let mut input = Vec::new();
    std::io::stdin()
        .take(1_500_001)
        .read_to_end(&mut input)
        .map_err(|_| "Could not read runner input")?;
    if input.len() > 1_500_000 {
        return Err("Runner input too large".into());
    }
    let input: Input = serde_json::from_slice(&input).map_err(|_| "Invalid runner input")?;
    let output = match input {
        Input::Provision => serde_json::to_vec(&OutLayerEnclave::provision()?),
        Input::Verify {
            report,
            config,
            sealed_state,
        } => {
            if std::env::var("ALLOW_DEVELOPMENT_INFERENCE").as_deref() != Ok("true") {
                return Err("Confidential model adapter is not configured".into());
            }
            let policy_hash =
                std::env::var("ATTESTATION_HASH").map_err(|_| "Missing runtime policy")?;
            hash_field(&policy_hash)?;
            let enclave = OutLayerEnclave::load(&sealed_state)?;
            let api_key = std::env::var("NEAR_AI_APIKEY").map_err(|_| "Missing model key")?;
            let mut model = match std::env::var("MODEL_POLICY") {
                Ok(policy) => {
                    let policy: ModelPolicy =
                        serde_json::from_str(&policy).map_err(|_| "Invalid model policy")?;
                    if policy.model != config.model {
                        return Err("Model policy does not match target config".into());
                    }
                    let random =
                        zeroize::Zeroizing::new(wasi::random::random::get_random_bytes(64));
                    let nonce = random[..32].try_into().map_err(|_| "Invalid entropy")?;
                    let seed = random[32..].try_into().map_err(|_| "Invalid entropy")?;
                    NearAiModel::attested(api_key, &policy, nonce, seed)?.0
                }
                Err(_) => NearAiModel::development(api_key)?,
            };
            let result = workflow::verify(
                VerifyRequest {
                    action: "verify".into(),
                    report,
                    config,
                },
                &enclave,
                &mut model,
                &policy_hash,
            )?;
            serde_json::to_vec(&result)
        }
    }
    .map_err(|_| "Invalid runner output")?;
    if output.len() > 1_400_000 {
        return Err("Runner output too large".into());
    }
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&output)
        .map_err(|_| "Could not write runner output")?;
    stdout
        .flush()
        .map_err(|_| "Could not flush runner output")?;
    Ok(())
}

#[cfg(not(all(target_arch = "wasm32", target_os = "wasi")))]
fn main() {
    eprintln!("Build this runner for wasm32-wasip2");
    std::process::exit(1);
}
