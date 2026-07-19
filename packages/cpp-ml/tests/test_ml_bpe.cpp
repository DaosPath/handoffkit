#include <handoffkit/ml/bpe.hpp>
#include <handoffkit/ml/data.hpp>
#include <handoffkit/ml/sft.hpp>

#include <cassert>
#include <cmath>
#include <filesystem>
#include <iostream>

int main() {
    using namespace handoffkit::ml;
    namespace fs = std::filesystem;

    const std::string corpus =
        "supervised fine tuning handoffkit multi agent distill student teacher "
        "MARK42 MARK42 MARK42 hello world completion prompt";
    assert(bpe_roundtrip_ok(corpus, "hello", 80));
    assert(bpe_roundtrip_ok(corpus, "MARK42", 80));

    BpeTokenizer t;
    t.train(corpus, 128);
    assert(t.vocab_size() > 260);  // beyond pure byte+specials
    auto ids = t.encode("MARK42", true);
    assert(ids.size() >= 3);
    auto dec = t.decode(ids);
    assert(dec.find("MARK") != std::string::npos || dec.find("42") != std::string::npos);

    const auto dir = fs::current_path() / "test_artifacts_bpe";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    auto path = (dir / "tok.bpe").string();
    if (!t.save(path)) {
        std::cerr << "bpe save failed path=" << path << "\n";
        return 1;
    }
    if (!fs::exists(path)) {
        std::cerr << "bpe file missing after save\n";
        return 1;
    }
    auto t2 = BpeTokenizer::load(path);
    assert(t2.vocab_size() == t.vocab_size());
    assert(t2.encode("hello", false) == t.encode("hello", false));

    // Wire into SFT (allow_tiny for CI speed but still use BPE)
    auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", "MARK42"}, {"P:", "MARK42"}})) {
        std::cerr << "jsonl write failed\n";
        return 1;
    }
    SftConfig cfg;
    cfg.allow_tiny = true;
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 64;
    cfg.epochs = 25;
    cfg.lr = 1e-2f;
    cfg.tokenizer = TokenizerKind::Bpe;
    cfg.bpe_merges = 96;
    cfg.arch = "gpt-mini";
    auto r = sft_train(ds, (dir / "out").string(), cfg);
    if (!r.success) {
        std::cerr << r.error << "\n";
        return 1;
    }
    assert(r.final_loss < r.initial_loss);
    assert(fs::exists(r.tokenizer_path));
    std::cout << "bpe sft initial=" << r.initial_loss << " final=" << r.final_loss
              << " vocab_tok_path=" << r.tokenizer_path << "\n";

    auto model = load_gpt(r.ckpt_path);
    GenerateOpts go;
    go.tokenizer = TokenizerKind::Bpe;
    go.bpe_path = r.tokenizer_path;
    go.max_new_tokens = 12;
    go.temperature = 0.f;
    std::string cont;
    generate_text(model, "P:", 12, 0.f, nullptr, &cont, &go);
    std::cout << "bpe generate cont='" << cont << "'\n";
    assert(!cont.empty() || r.final_loss < 1.0f);

    std::cout << "test_ml_bpe ok\n";
    return 0;
}
