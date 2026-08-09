# ARM64 local qualification — Orange Pi 6 Plus

Estado: nota local para trabajo futuro. No es evidencia de release.

## Equipo disponible

- Orange Pi 6 Plus.
- SoC CIX CD8180/CD8160.
- 16 GB LPDDR5.
- Fuente USB-C 20 V / 5 A.
- Disipador.
- Linux ARM64 requerido para la validación principal.

La ficha oficial lista CPU de 64 bits y Windows entre los sistemas disponibles:
<https://www.orangepi.org/html/hardWare/computerAndMicrocontrollers/details/Orange-Pi-6-Plus.html>

## Uso para HandoffKit 1.19

La placa sirve como ejecución **Linux ARM64 nativa**. Debe probar:

- Python, Node, Go y Rust.
- C++ y `cpp-ml` en modo CPU.
- TLS 1.3, mTLS y errores de certificados.
- Replay, recuperación durable y scheduler.
- Interoperabilidad TCP Node/Go/Rust ↔ C++.
- Keystore/provider disponible en el sistema.
- Benchmarks ambientales con arquitectura y versiones registradas.

No usar los resultados como garantía universal de rendimiento. Registrar commit,
arquitectura, kernel, distribución, compiladores, OpenSSL y versiones de cada runtime.

## Comprobación inicial

```bash
uname -a
uname -m
getconf LONG_BIT
cat /etc/os-release
nproc
free -h
openssl version
python3 --version
node --version
go version
rustc --version
cmake --version
```

Debe aparecer `aarch64` y `64`.

## Windows ARM

Puede ser posible usando imagen/BSP/UEFI y drivers ARM64 específicos del fabricante.
La ficha del producto no sustituye una prueba de arranque y drivers. Microsoft exige
UEFI compatible y drivers nativos ARM64; la emulación x64 no cubre drivers del kernel:
<https://learn.microsoft.com/en-us/windows-hardware/drivers/bringup/minimum-uefi-requirements-for-windows-on-soc-platforms>
<https://learn.microsoft.com/en-us/windows/arm/faq>

Windows ARM sería una cualificación adicional. No reemplaza Linux ARM64 ni macOS
ARM64. No declarar soporte Windows hasta tener imagen reproducible, arranque,
drivers, tests y artifacts.

## Qué queda fuera

- La Orange Pi no valida macOS ARM64.
- No demuestra soporte para todos los dispositivos ARM.
- NPU/GPU/CUDA no cuentan para `cpp-ml` CPU.
- Exactly-once, zeroization global, OCSP fetch, ML-DSA/ECDSA/SLH-DSA y
  hybrid-PQ fuera de Node/Go siguen `unavailable`.

## Evidencia de cierre

Guardar en `.local-tests/` durante la ejecución (no versionar): logs, JSON de
benchmarks, matriz TCP y resumen con SHA del commit. El informe público solo puede
subir ARM de “configurado” a “probado” después de una ejecución nativa completa.
