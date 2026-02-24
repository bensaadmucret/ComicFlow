# ComicFlow | Premium CBZ Viewer

ComicFlow est un visualiseur web moderne, performant et élégant pour les fichiers CBZ (Comic Book ZIP). Conçu pour offrir une expérience de lecture immersive, il transforme votre navigateur en un véritable lecteur de bandes dessinées.

## ✨ Fonctionnalités Premium

- **🎨 Design Sophistiqué** : Interface moderne basée sur le "Glassmorphism" avec des effets de flou et une typographie raffinée (Inter).
- **🚀 Performance Optimisée** :
    - **Mise en cache intelligente** : Les images sont conservées en mémoire pour un accès instantané.
    - **Préchargement (Prefetching)** : Anticipation de la lecture et chargement des pages suivantes en arrière-plan.
- **📖 Modes de Lecture Avancés** :
    - **Mode Manga (RTL)** : Inversion du sens de lecture pour les œuvres japonaises.
    - **Mode Double-Page (Spread)** : Affichage de deux pages côte à côte pour une lecture naturelle sur grand écran.
- **📺 Plein Écran Immersif** :
    - Mode plein écran total avec auto-hide des contrôles.
    - Apparition des menus au mouvement de la souris ou au survol.
    - Indicateurs visuels de navigation latérale.
- **💾 Persistance de la lecture** : Sauvegarde automatique de votre progression pour chaque fichier (via LocalStorage).
- **🖱️ Ergonomie Intuitive** :
    - Support du Glisser-Déposer (Drag & Drop) pour ouvrir des fichiers.
    - Navigation au clavier (Flèches, Touche 'F').
    - Barre latérale de paramètres escamotable.

## 🛠️ Technologies utilisées

- **HTML5 & CSS3** (Variables CSS, Flexbox, Backdrop-filter)
- **Vanilla JavaScript** (ES6+)
- **JSZip** : Décompression haute performance côté client.
- **Google Fonts (Inter)** : Typographie optimisée pour la lecture.

## 🚀 Utilisation

1. Ouvrez `index.html` dans votre navigateur.
2. Glissez-déposez un fichier CBZ ou utilisez le bouton "Ouvrir".
3. Configurez vos préférences (Manga, Double-page) dans la barre latérale.
4. Utilisez les flèches du clavier ou les zones cliquables sur les côtés pour naviguer.

## 📦 Installation

Aucune installation complexe n'est requise. ComicFlow est une application "single-file" (plus JSZip) qui fonctionne directement dans tout navigateur moderne.

## ⚠️ Limitations

- Formats supportés : `.cbz` (ZIP contenant des images).
- Formats d'images supportés : JPG, PNG, GIF, WEBP.
