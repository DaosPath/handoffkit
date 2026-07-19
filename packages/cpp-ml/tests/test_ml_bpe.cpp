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
        "MARK42 MARK42 MARK42 hello world completion prompt P: P: P:";
    assert(bpe_roundtrip_ok(corpus, "hello", 80));
    assert(bpe_roundtrip_ok(corpus, "MARK42", 80));

    BpeTokenizer t;
    t.train(corpus, 128);
    assert(t.vocab_size() > 260);

    // Prefix safety: encode_sft prompt tokens are a prefix of full sequence
    auto full = t.encode_sft("P:", "MARK42", true);
    auto pref = t.encode_raw("P:");
    // full = [BOS] + pref + encode_raw(completion) + [EOS]
    assert(full.size() >= pref.size() + 2);
    assert(full[0] == t.bos_id);
    for (std::size_t i = 0; i < pref.size(); ++i) {
        assert(full[i + 1] == pref[i]);
    }
    std::cout << "bpe prefix-safe ok pref_len=" << pref.size() << " full_len=" << full.size()
              << "\n";

    const auto dir = fs::current_path() / "test_artifacts_bpe";
    std::error_code ec;
    fs::remove_all(dir, ec);
    fs::create_directories(dir, ec);
    auto path = (dir / "tok.bpe").string();
    if (!t.save(path) || !fs::exists(path)) {
        std::cerr << "bpe save failed\n";
        return 1;
    }
    auto t2 = BpeTokenizer::load(path);
    assert(t2.vocab_size() == t.vocab_size());
    assert(t2.encode_raw("hello") == t.encode_raw("hello"));

    auto ds = (dir / "data.jsonl").string();
    if (!write_sft_jsonl(ds, {{"P:", "MARK42"}, {"P:", "MARK42"}, {"P:", "MARK42"}})) {
        std::cerr << "jsonl write failed\n";
        return 1;
    }
    SftConfig cfg;
    cfg.allow_tiny = true;
    cfg.n_embd = 64;
    cfg.n_head = 4;
    cfg.n_layer = 2;
    cfg.block_size = 64;
    cfg.epochs = 40;
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
    std::cout << "bpe sft initial=" << r.initial_loss << " final=" << r.final_loss << "\n";

    auto model = load_gpt(r.ckpt_path);
    GenerateOpts go;
    go.tokenizer = TokenizerKind::Bpe;
    go.bpe_path = r.tokenizer_path;
    go.max_new_tokens = 16;
    go.temperature = 0.f;
    std::string cont;
    generate_text(model, "P:", 16, 0.f, nullptr, &cont, &go);
    std::cout << "bpe generate cont='" << cont << "'\n";
    // AC2: non-byte tokenizer must produce non-empty continuation after SFT overfit
    if (cont.empty()) {
        std::cerr << "FAIL: BPE generate continuation empty after SFT\n";
        return 1;
    }
    // Should contain memorized content or at least printable ASCII
    bool printable = false;
    for (unsigned char c : cont) {
        if (c >= 32 && c < 127) printable = true;
    }
    assert(printable);

    std::cout << "test_ml_bpe ok\n";
    return 0;
}
