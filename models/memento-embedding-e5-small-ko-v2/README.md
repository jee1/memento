# @jee1/memento-embedding-e5-small-ko-v2

memento 의 로컬 임베딩 모델 파일만 담은 npm 패키지다. `memento-mcp-server` 가 정확한 버전으로 의존하고, 런타임은 원격 내려받기를 끈 채 이 패키지 안 폴더에서 모델을 읽는다(#1729).

- 원본 모델: [dragonkue/multilingual-e5-small-ko-v2](https://huggingface.co/dragonkue/multilingual-e5-small-ko-v2), revision `fcfc26bf355882620c48df58be112275bd756f50`, apache-2.0
- 기반 모델: [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), MIT
- 변경: optimum 으로 ONNX 내보내기, onnxruntime 동적 int8(QUInt8) 양자화. fp32 모델은 싣지 않는다. 자세한 내용은 `NOTICE`.

## 싣는 파일

```
multilingual-e5-small-ko-v2/
  config.json
  special_tokens_map.json
  tokenizer.json
  tokenizer_config.json
  onnx/model_quantized.onnx
LICENSE  NOTICE  README.md
```

모델 폴더 이름(`multilingual-e5-small-ko-v2`)이 transformers.js 의 모델 id 이고 `memory_embedding.model` 에 저장되는 이름과 같다. 다섯 파일의 sha256 은 `sha256.json` 에 있다. 측정에 쓴 파일과 같은 값이다.

## 만들기와 게시 (주인만)

```bash
./publish.sh --dry-run   # 가상환경 준비, 변환, sha256 대조, npm publish --dry-run 크기 확인까지
./publish.sh             # 위와 같고, 확인을 받은 뒤 npm publish --access public
```

- 변환 도구 버전은 `requirements.txt` 로 고정한다(측정에 쓴 환경의 목록 그대로, python 3.12).
- `build.py` 는 원본을 고정한 revision 으로 받아 변환하고 `sha256.json` 과 대조한다. 하나라도 어긋나면 멈춘다. 같은 기계, 같은 도구 버전에서는 비트 단위로 같았다. 다른 기계에서 같은지는 모른다. 어긋나면 게시하지 않는다.
- 처음 게시는 주인의 npm 로그인으로 한다. npm OIDC trusted publishing 은 이미 있는 패키지에만 붙고 새 패키지를 만들지 못한다.
- 게시 워크플로는 없다. 모델 파일이 바뀔 때만 다시 게시한다.

## 버전 규칙

- 모델 파일 바이트가 그대로이고 README, NOTICE, `package.json` 만 바뀌면 patch 를 올린다.
- 모델 파일 바이트가 바뀌면(다시 변환) major 를 올리고 memento 의 저장 이름(`storedName`)도 바꾼다. 같은 저장 이름에 다른 벡터가 섞이지 않게 한다.
- 다른 모델은 새 패키지 이름이다.
