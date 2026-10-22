# SOS Wear — Contacto de emergencia

Aplicación Expo para recibir las emergencias del backend SOS en iOS y Android. Se ejecuta en Expo Go; no requiere dev build, claves de mapas ni módulos nativos propios. El mapa usa Leaflet y OpenStreetMap.

## Requisitos y arranque

1. Instala Node.js y la app Expo Go en el teléfono.
2. Desde PowerShell, en la raíz `A3`, instala las dependencias y arranca Expo:

   ```powershell
   cd contacto
   npm install
   npx expo start
   ```

3. Escanea el QR con la cámara del iPhone y abre Expo Go, o escanéalo desde Expo Go en Android.
4. En **Configuración**, guarda la URL del backend, el nombre del contacto y el teléfono para llamar. La URL debe usar la IP de la PC, por ejemplo `http://192.168.1.25:3000`; no uses `localhost` desde el teléfono.

## Conexión en la red local

- En Windows, ejecuta `ipconfig` y busca la **Dirección IPv4** del adaptador Wi-Fi conectado a la misma red que el teléfono. Sustituye esa dirección en la URL del backend.
- El backend debe escuchar en `0.0.0.0:3000`. Permite conexiones TCP entrantes desde la red privada para los puertos **3000** (API) y **8081** (Metro/Expo). En PowerShell como administrador, una regla de ejemplo es:

  ```powershell
  New-NetFirewallRule -DisplayName "SOS Wear Expo y API" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000,8081 -Profile Private
  ```

- En iOS, permite **Red local** para Expo Go cuando iOS lo solicite; si lo rechazaste, actívalo en **Ajustes > Privacidad y seguridad > Red local > Expo Go**.
- Si el Wi-Fi de la escuela/empresa bloquea la comunicación entre dispositivos, conecta PC y teléfono al hotspot del celular. Como alternativa para cargar el bundle de Expo, ejecuta `npx expo start --tunnel`; el backend aún necesita ser accesible desde el teléfono.
- El dashboard existente del backend continúa disponible en `http://IP_DE_LA_PC:3000/dashboard`.

## Alertas y limitaciones de Expo Go

La app pide permiso para notificaciones al abrir, usa el canal Android `sos` con importancia máxima, vibración y sonido predeterminado, y mantiene la pantalla encendida mientras permanece abierta. En Expo Go, la alerta es confiable con la app abierta o recién minimizada; la entrega real en segundo plano requiere un build propio de EAS. En iOS, el interruptor de silencio y el modo Concentración pueden silenciar el sonido.

## Verificación

Desde esta carpeta:

```powershell
npx tsc --noEmit
npx expo-doctor
```

Checklist manual, usando `.\scripts\simular-sos.ps1` desde la raíz del proyecto para simular una ruta:

- [ ] Una alerta nueva suena y vibra.
- [ ] El marcador y el rastro se actualizan durante la simulación.
- [ ] «Voy en camino» aparece en el dashboard del backend.
- [ ] La emergencia finalizada pasa a gris.
- [ ] Con el backend apagado, aparece «Sin conexión» y la app permanece abierta.
