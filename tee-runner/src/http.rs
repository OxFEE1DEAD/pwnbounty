use crate::Result;
use std::time::Duration;
use wasi::{
    clocks::monotonic_clock,
    http::{
        outgoing_handler,
        types::{Fields, Method, OutgoingBody, OutgoingRequest, RequestOptions, Scheme},
    },
    io::{
        poll::{poll, Pollable},
        streams::StreamError,
    },
};

pub struct Response {
    pub status: u16,
    pub body: Vec<u8>,
}

fn wait(stream: &Pollable, deadline: u64) -> Result<()> {
    if monotonic_clock::now() >= deadline {
        return Err("HTTP deadline exceeded".into());
    }
    let timer = monotonic_clock::subscribe_instant(deadline);
    let ready = poll(&[stream, &timer]);
    if ready.contains(&1) || monotonic_clock::now() >= deadline {
        return Err("HTTP deadline exceeded".into());
    }
    Ok(())
}

pub fn post_json(
    host: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    timeout: Duration,
    max_response: usize,
) -> Result<Response> {
    send(
        Method::Post,
        host,
        path,
        headers,
        body,
        timeout,
        max_response,
    )
}

pub fn get(
    host: &str,
    path: &str,
    headers: &[(&str, &str)],
    timeout: Duration,
    max_response: usize,
) -> Result<Response> {
    send(Method::Get, host, path, headers, &[], timeout, max_response)
}

fn send(
    method: Method,
    host: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: &[u8],
    timeout: Duration,
    max_response: usize,
) -> Result<Response> {
    if !matches!(
        host,
        "cloud-api.near.ai" | "rpc.testnet.near.org" | "rpc.mainnet.near.org"
    ) || !path.starts_with('/')
    {
        return Err("HTTP destination is not allowed".into());
    }
    if body.len() > 1_500_000
        || max_response > 1_500_000
        || timeout.is_zero()
        || timeout > Duration::from_secs(180)
    {
        return Err("Invalid HTTP limits".into());
    }
    let nanos = u64::try_from(timeout.as_nanos()).map_err(|_| "Invalid timeout")?;
    let deadline = monotonic_clock::now()
        .checked_add(nanos)
        .ok_or("Deadline overflow")?;
    let fields = Fields::new();
    fields
        .set(&"content-type".into(), &[b"application/json".to_vec()])
        .map_err(|_| "Invalid header")?;
    for (name, value) in headers {
        fields
            .set(&name.to_string(), &[value.as_bytes().to_vec()])
            .map_err(|_| "Invalid header")?;
    }
    let request = OutgoingRequest::new(fields);
    request.set_method(&method).map_err(|_| "Invalid method")?;
    request
        .set_scheme(Some(&Scheme::Https))
        .map_err(|_| "Invalid scheme")?;
    request
        .set_authority(Some(host))
        .map_err(|_| "Invalid authority")?;
    request
        .set_path_with_query(Some(path))
        .map_err(|_| "Invalid path")?;
    let outgoing = request.body().map_err(|_| "Missing outgoing body")?;
    let options = RequestOptions::new();
    options
        .set_connect_timeout(Some(nanos))
        .map_err(|_| "Unsupported connect timeout")?;
    options
        .set_first_byte_timeout(Some(nanos))
        .map_err(|_| "Unsupported first-byte timeout")?;
    options
        .set_between_bytes_timeout(Some(nanos))
        .map_err(|_| "Unsupported stream timeout")?;
    let future =
        outgoing_handler::handle(request, Some(options)).map_err(|_| "HTTP request failed")?;
    {
        let stream = outgoing.write().map_err(|_| "Missing request stream")?;
        let mut offset = 0;
        while offset < body.len() {
            wait(&stream.subscribe(), deadline)?;
            let capacity = stream.check_write().map_err(|_| "HTTP write failed")? as usize;
            if capacity == 0 {
                continue;
            }
            let end = offset + capacity.min(body.len() - offset);
            stream
                .write(&body[offset..end])
                .map_err(|_| "HTTP write failed")?;
            offset = end;
        }
        stream.flush().map_err(|_| "HTTP flush failed")?;
        loop {
            wait(&stream.subscribe(), deadline)?;
            if stream.check_write().map_err(|_| "HTTP flush failed")? > 0 {
                break;
            }
        }
    }
    OutgoingBody::finish(outgoing, None).map_err(|_| "HTTP body completion failed")?;
    let response = loop {
        if let Some(response) = future.get() {
            break response
                .map_err(|_| "HTTP response consumed")?
                .map_err(|_| "HTTP transport failed")?;
        }
        wait(&future.subscribe(), deadline)?;
    };
    let status = response.status();
    let incoming = response.consume().map_err(|_| "Missing response body")?;
    drop(response);
    let mut bytes = Vec::new();
    {
        let stream = incoming.stream().map_err(|_| "Missing response stream")?;
        loop {
            wait(&stream.subscribe(), deadline)?;
            match stream.read(8192) {
                Ok(chunk) => {
                    if bytes.len() + chunk.len() > max_response {
                        return Err("HTTP response too large".into());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Err(StreamError::Closed) => break,
                Err(_) => return Err("HTTP response stream failed".into()),
            }
        }
    }
    drop(incoming);
    Ok(Response {
        status,
        body: bytes,
    })
}
