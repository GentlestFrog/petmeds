# Diario de salud — instalación (Firebase + GitHub Pages)

Esta app queda 100% tuya: no depende de Claude ni de este chat. Vos la alojás en tu
propio GitHub y los datos viven en tu propio proyecto de Firebase (gratis para este uso).

Se hace una sola vez. Son ~20 minutos.

---

## Parte 1 — Crear el proyecto de Firebase

1. Andá a **https://console.firebase.google.com** y entrá con tu cuenta de Google.

2. **Agregar proyecto** → ponele un nombre (ej. "diario-perrito") → seguir los pasos
   por defecto (podés desactivar Google Analytics, no hace falta) → **Crear proyecto**.

3. En el menú izquierdo: **Compilación → Authentication** → botón **Comenzar**.

4. Pestaña **Sign-in method** → elegí **Google** de la lista → activalo (switch arriba
   a la derecha) → elegí un email de soporte → **Guardar**.

5. En el menú izquierdo: **Compilación → Firestore Database** → **Crear base de datos**.
   - Elegí la ubicación más cercana a vos (cualquiera sirve).
   - Modo: **Producción** (no "modo de prueba").

6. Andá a la pestaña **Reglas** de Firestore y reemplazá todo el contenido por el que
   está en el archivo `firestore.rules` de esta carpeta. Tocá **Publicar**.

7. Volvé a **Configuración del proyecto** (ícono de engranaje, arriba a la izquierda)
   → pestaña **General** → bajá hasta **Tus apps** → tocá el ícono **</>** (Web).
   - Ponele un apodo (ej. "diario-web") → **Registrar app**.
   - NO hace falta Firebase Hosting, podés saltear ese paso.
   - Vas a ver un bloque `const firebaseConfig = {...}`. **Copiá esos valores**.

8. Abrí el archivo `firebase-config.js` de esta carpeta y reemplazá cada `TODO...`
   por los valores que copiaste. Guardá el archivo.

---

## Parte 2 — Subir la app a GitHub Pages

1. Andá a **https://github.com** → **New repository** → nombre libre (ej. `diario-perrito`)
   → público o privado (cualquiera funciona con GitHub Pages) → **Create repository**.

2. Subí estos 4 archivos al repositorio (botón **Add file → Upload files**, arrastralos):
   - `index.html`
   - `app.js`
   - `firebase-config.js` (¡ya con tus claves pegadas!)
   - (podés subir también `firestore.rules` y este `README.md` de referencia, no molestan)

3. **Settings** del repositorio → **Pages** (menú izquierdo) →
   en "Branch" elegí `main` y carpeta `/ (root)` → **Save**.

4. Esperá 1-2 minutos y arriba te va a aparecer la URL pública, algo como:
   `https://TU-USUARIO.github.io/diario-perrito/`

---

## Parte 3 — Autorizar ese dominio en Firebase

1. Volvé a Firebase → **Authentication → Settings → Authorized domains**.
2. Tocá **Add domain** y pegá tu dominio de GitHub Pages, SIN el `https://` y sin la
   barra final, por ejemplo: `tu-usuario.github.io`

Sin este paso, el login con Google va a fallar con un error de dominio no autorizado.

---

## Parte 4 — Usarla

1. Abrí tu URL de GitHub Pages.
2. **Iniciar sesión con Google**.
3. Primera vez: tocá **Crear mi hogar** (te crea tu primera mascota, editable en Ajustes).
4. Ya podés usar las pestañas Hoy / Medicación / Historial / Ajustes con todas las
   funciones que ya conocés (medicación fija/variable/recurrente, día X de Y,
   recordatorio de calendario, etc).

### Invitar a otro cuidador (otra cuenta de Google)

1. Vos (el dueño), en **Ajustes → Compartir con otro cuidador**:
   - Copiá el **código de tu hogar**.
   - Escribí el **email de Google** de la otra persona y tocá **Autorizar este email**.
2. Envíale el código (por WhatsApp, mail, como prefieras) y la URL de la app.
3. Esa persona entra a la URL, **inicia sesión con SU propia cuenta de Google**
   (tiene que ser el email que autorizaste), pega el código en **"Ya tengo un código"**
   y toca **Unirme**.
4. A partir de ahí, ambos ven y editan exactamente la misma información.

Podés autorizar más de un email si hace falta, y quitarlos después desde el mismo
lugar (menos el tuyo, que es el dueño).

---

## Notas importantes

- **Costo**: todo esto entra cómodo en el plan gratuito ("Spark") de Firebase para
  el uso de una sola familia. No hace falta tarjeta de crédito.
- **Privacidad**: solo pueden entrar las cuentas de Google que vos autorices
  explícitamente. Nadie más puede ver los datos, ni siquiera con el link de GitHub
  Pages (sin loguearse con un email autorizado, Firestore rechaza el acceso).
- **Backups**: los datos están en Firestore, en tu proyecto de Firebase — es tan
  durable como cualquier producto de Google Cloud. Podés exportar la base desde
  la consola de Firebase si alguna vez querés un respaldo aparte.
- **No reemplaza al veterinario**: ante cualquier síntoma preocupante, consultá
  siempre con tu veterinario.
