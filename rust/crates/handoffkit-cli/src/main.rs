#[tokio::main]
async fn main() {
    if let Err(error) = handoffkit_cli::run(std::env::args().skip(1).collect()).await {
        eprintln!("handoffkit-rs: {error}");
        std::process::exit(1);
    }
}
