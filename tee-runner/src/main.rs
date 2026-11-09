#[cfg(all(target_arch = "wasm32", target_os = "wasi"))]
fn main() {
    if let Err(error) = run() {
        eprintln!("Runner execution failed: {error}");
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
            let policy_hash =
                std::env::var("ATTESTATION_HASH").map_err(|_| "Missing runtime policy")?;
            hash_field(&policy_hash)?;
            let enclave = OutLayerEnclave::load(&sealed_state)?;
            let api_key = std::env::var("NEAR_AI_APIKEY").map_err(|_| "Missing model key")?;
            let expected_policy_hash = config
                .model_policy_hash
                .as_ref()
                .ok_or("OutLayer target does not pin model policy")?;
            let text = std::env::var("MODEL_POLICY").map_err(|_| "Missing model policy")?;
            let policies: Vec<ModelPolicy> = serde_json::from_str(&text)
                .or_else(|_| serde_json::from_str(&text).map(|policy| vec![policy]))
                .map_err(|_| "Invalid model policy")?;
            let policy = policies
                .into_iter()
                .find(|p| p.model == config.model && p.require_hash(expected_policy_hash).is_ok())
                .ok_or("Model policy does not match target config")?;
            let random = zeroize::Zeroizing::new(wasi::random::random::get_random_bytes(64));
            let nonce = random[..32].try_into().map_err(|_| "Invalid entropy")?;
            let seed = random[32..].try_into().map_err(|_| "Invalid entropy")?;
            let mut model = NearAiModel::attested(api_key, &policy, nonce, seed)?.0;
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
