"""memento 로컬 임베딩 모델 파일을 원본 가중치에서 만들고 sha256.json 과 대조한다 (#1729).

dragonkue/multilingual-e5-small-ko-v2 를 고정한 revision 으로 받아 optimum 으로 ONNX 로 내보내고,
onnxruntime 동적 int8(QUInt8)로 양자화한다. 결과는 이 폴더의 multilingual-e5-small-ko-v2/ 에 쓴다.
fp32 ONNX(470MB)는 싣지 않는다. 대조가 하나라도 어긋나면 0 이 아닌 값으로 끝난다.

usage: python build.py           # 만들고 대조
       python build.py --verify  # 이미 만든 파일만 대조
"""
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

REPO = 'dragonkue/multilingual-e5-small-ko-v2'
REVISION = 'fcfc26bf355882620c48df58be112275bd756f50'
HERE = Path(__file__).resolve().parent
MODEL_DIR = 'multilingual-e5-small-ko-v2'


def build(out: Path) -> None:
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from optimum.onnxruntime import ORTModelForFeatureExtraction
    from transformers import AutoTokenizer

    if out.exists():
        shutil.rmtree(out)
    (out / 'onnx').mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        exported = Path(tmp)
        ORTModelForFeatureExtraction.from_pretrained(REPO, revision=REVISION, export=True).save_pretrained(exported)
        AutoTokenizer.from_pretrained(REPO, revision=REVISION).save_pretrained(out)
        shutil.copy(exported / 'config.json', out / 'config.json')
        quantize_dynamic(
            str(exported / 'model.onnx'),
            str(out / 'onnx' / 'model_quantized.onnx'),
            weight_type=QuantType.QUInt8,
        )


def verify() -> list[str]:
    expected: dict[str, str] = json.loads((HERE / 'sha256.json').read_text(encoding='utf-8'))
    actual = {
        path.relative_to(HERE).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (HERE / MODEL_DIR).rglob('*')
        if path.is_file()
    }
    problems = [f'{name}: 없음' for name in expected if name not in actual]
    problems += [f'{name}: 예상 밖 파일' for name in actual if name not in expected]
    problems += [
        f'{name}: sha256 {actual[name]} != {digest}'
        for name, digest in expected.items()
        if name in actual and actual[name] != digest
    ]
    return problems


if __name__ == '__main__':
    if '--verify' not in sys.argv[1:]:
        build(HERE / MODEL_DIR)
    problems = verify()
    for problem in problems:
        print(f'불일치 {problem}', file=sys.stderr)
    if problems:
        sys.exit(1)
    print(f'sha256 일치: {MODEL_DIR}/ 파일 {len(json.loads((HERE / "sha256.json").read_text(encoding="utf-8")))}개')
