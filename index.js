import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent chama AppRegistry.registerComponent('main', () => App);
// Garante o registro do ponto de entrada "main" tanto no Expo Go quanto em builds nativos
registerRootComponent(App);

