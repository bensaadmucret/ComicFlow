# Maquettes Tailwind "ComicFlow"

## Contenu
- `comicflow-tailwind.html` : maquette statique (v2) avec layout en grille (bibliothèque · viewer · panneau) et palette Syne/pulse.
- `comicflow-fullscreen.html` : concept fullscreen immersif.
- `comicflow-fullscreen-reader.html` : mode lecture ratio A4 avec planche `082.jpg`.

## Aperçu
Ouvrir directement le fichier dans un navigateur moderne :
```bash
open mockups/comicflow-tailwind.html
```

## Intégration dans le projet
1. Ajouter Tailwind via CDN (démo) ou via pipeline build (recommandé pour l'app finale).
2. Remplacer la structure HTML principale de `index.html` par les blocs de la maquette choisie (header, bibli, viewer, panneaux).
3. Brancher les scripts existants :
   - Associer les boutons "Importer", "Mode", navigation etc. aux fonctions JS actuelles (`handleFileSelect`, `setReadingMode`, `navigate`, ...).
   - Remplacer les images statiques par `img` contrôlées via JS (`comicImage1`, `comicImage2`).
4. Adapter les classes Tailwind si nécessaire pour les états actifs/désactivés (ex. `toggle-btn`).

## Notes
- Les polices utilisées : Syne (titres) + IBM Plex Mono ou DM Sans selon la maquette.
- Palette personnalisée dans `tailwind.config` (`midnight`, `pulse`, etc.).
- Éléments décoratifs (bruit, gradients) sont purement CSS, amovibles si besoin.
