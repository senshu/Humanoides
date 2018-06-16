
import "pixi.js";
import * as player from "./player.js";
import {Human} from "./human.js";
import {Robot} from "./robot.js";

const TILE_WIDTH_PX      = 24;
const TILE_HEIGHT_PX     = 24;
const MARGIN             = 4;
const HUMAN_LIVES        = 3;
const TILE_HIDE_DELAY_MS = 5000;

const FALL_COST = 0.9;
const HUMAN_BRICK_COST = 3;
const ROBOT_BRICK_COST = TILE_HEIGHT_PX + TILE_WIDTH_PX;

const SYMBOLS = {
    "%": "brick",
    "H": "ladder",
    "-": "rope",
    "@": "gift",
    "X": "human",
    "#": "robot"
};

const KEYS = {
    left:       ["ArrowLeft"],
    up:         ["ArrowUp"],
    right:      ["ArrowRight"],
    down:       ["ArrowDown"],
    breakLeft:  ["s", "S"],
    breakRight: ["d", "D"]
};

export const Board = {
    init(data) {
        this.rows = data.map(row => row.split(""));
        this.widthTiles = Math.max(...this.rows.map(r => r.length));
        this.heightTiles = this.rows.length;
        this.gravity = TILE_HEIGHT_PX / this.heightTiles / 18;

        this.renderer = PIXI.autoDetectRenderer(this.widthTiles * TILE_WIDTH_PX, (this.heightTiles + 1) * TILE_HEIGHT_PX + 2 * MARGIN);
        document.body.appendChild(this.renderer.view);

        this.stage = new PIXI.Container();

        Object.values(SYMBOLS).forEach(name => PIXI.loader.add(`assets/${name}.png`));
        PIXI.loader.load(() => this.setup());

        return this;
    },

    setup() {
        // Load textures.
        let textures = {};
        for (let symbol in SYMBOLS) {
            const spriteName = SYMBOLS[symbol];
            textures[spriteName] = PIXI.BaseTexture.fromImage(`assets/${spriteName}.png`);
        }

        this.robots = [];
        this.tiles = [];
        this.gifts = [];
        this.targets = [];

        // For each tile
        this.rows.forEach((row, ytl) => {
            const tileRow = [];
            this.tiles.push(tileRow);

            row.forEach((symbol, xtl) => {
                if (symbol in SYMBOLS) {
                    // Create a sprite for the current symbol
                    const spriteName = SYMBOLS[symbol];
                    const texture = new PIXI.Texture(textures[spriteName]);
                    const sprite = new PIXI.Sprite(texture);

                    // Center the sprite in the current tile
                    sprite.anchor.x = sprite.anchor.y = 0.5;
                    sprite.x = this.xTileToPix(xtl);
                    sprite.y = this.yTileToPix(ytl);
                    this.stage.addChild(sprite);

                    // Keep a reference to the human sprite
                    switch (spriteName) {
                        case "human":
                            this.player = Object.create(Human).init(this, sprite);
                            tileRow.push(null);
                            break;
                        case "robot":
                            this.robots.push(Object.create(Robot).init(this, sprite));
                            tileRow.push(null);
                            break;
                        case "gift":
                            this.gifts.push({x: xtl, y: ytl, active: true});
                            tileRow.push(sprite);
                            break;
                        default:
                            tileRow.push(sprite);
                    }
                }
                else {
                    tileRow.push(null);
                }

                // Put a target at each end of a platform.
                if (symbol !== '%' && symbol !== 'H' && symbol !== '@') {
                    if (ytl + 1 === this.heightTiles) {
                        if (xtl === 0 || xtl + 1 === this.widthTiles || row[xtl - 1] === '%' || row[xtl + 1] === '%') {
                            this.targets.push({x: xtl, y: ytl, active: true});
                        }
                    }
                    else if (this.rows[ytl + 1][xtl] === '%') {
                        if (xtl === 0 || xtl + 1 === this.widthTiles || this.rows[ytl + 1][xtl - 1] !== '%' || this.rows[ytl + 1][xtl + 1] !== '%') {
                           this.targets.push({x: xtl, y: ytl, active: true});
                        }
                    }
                }
                // Put a target at each end of a rope.
                if (symbol === '-' && (xtl === 0 || xtl + 1 === this.widthTiles || row[xtl - 1] !== '-' || row[xtl + 1] !== '-')) {
                    this.targets.push({x: xtl, y: ytl, active: true});
                }
                // Put a target at each end of a ladder.
                if (symbol === 'H' && (ytl === 0 || ytl + 1 === this.heightTiles || this.rows[ytl - 1][xtl] !== 'H' ||  this.rows[ytl + 1][xtl] !== 'H')) {
                    this.targets.push({x: xtl, y: ytl, active: true});
                }
           });

           // Show remaining lives at the bottom of the screen.
           this.lifeSprites = [];
           const texture = new PIXI.Texture(textures.human, player.getDefaultFrame());
           for (let i = 0; i < HUMAN_LIVES; i ++) {
               const sprite = new PIXI.Sprite(texture);
               sprite.anchor.x = sprite.anchor.y = 0.5;
               sprite.x = (i                + 0.5) * TILE_WIDTH_PX  + MARGIN;
               sprite.y = (this.heightTiles + 0.5) * TILE_HEIGHT_PX + MARGIN;
               this.stage.addChild(sprite);

               this.lifeSprites.push(sprite);
           }
       });

       this.remainingGifts = this.gifts.length;
       this.targets = this.targets.concat(this.gifts);

       this.humanHints = this.computeHintMaps(FALL_COST, HUMAN_BRICK_COST);
       this.recomputeHints();

       window.addEventListener("keydown", (evt) => this.onKeyChange(evt, true));
       window.addEventListener("keyup", (evt)   => this.onKeyChange(evt, false));

       this.loop();
   },

   recomputeHints() {
       this.robotHints = this.computeHintMaps(FALL_COST, ROBOT_BRICK_COST);
   },

   computeHintMaps(fallCost, brickCost) {
       // Initialize the map with empty cells.
       const result = this.targets.map(g => this.rows.map(r => r.map(c => ({hint: '?', distance: Infinity}))));

       this.targets.forEach((g, gi) => {
           const currentMap = result[gi];

           currentMap[g.y][g.x] = {hint: '@', distance: 0};

           // Compute the hint map for the current target.
           currentMap.forEach((r, y) => r.forEach((c, x) => {
               // Compute a path from (x, y) to (g.x, g.y) using the A* algorithm.
               const closedList = [];
               const openList = [{x, y, cost: 0, distance: 0, prev: null}];
               let currentNode;
               while (openList.length) {
                   // Get the unexplored node with the lowest estimated path length.
                   currentNode = openList.shift();

                   // If the current node is the target, stop the exploration.
                   if (currentMap[currentNode.y][currentNode.x].hint != '?' || currentNode.x === g.x && currentNode.y === g.y) {
                       break;
                   }

                   // Add the current node to the list of explored nodes.
                   closedList.push(currentNode);

                   // Build a list of the neighbors of the current node.
                   // The list is based on the possible movements of the player at the current location.
                   const neighbors = [];
                   function addNeighbor(x, y, cost) {
                       neighbors.push({x, y, prev: currentNode, cost: currentNode.cost + cost, distance: Math.abs(g.x - x) + Math.abs(g.y - y)})
                   }

                   if (this.canStand(currentNode.x, currentNode.y) || this.canHang(currentNode.x, currentNode.y)) {
                       if (this.canMoveRight(currentNode.x, currentNode.y)) {
                           addNeighbor(currentNode.x + 1, currentNode.y, 1);
                       }
                       if (this.canMoveLeft(currentNode.x, currentNode.y)) {
                           addNeighbor(currentNode.x - 1, currentNode.y, 1);
                       }
                   }

                   if (this.canClimbDown(currentNode.x, currentNode.y)) {
                       addNeighbor(currentNode.x, currentNode.y + 1, 1);
                   }
                   else if (currentNode.y + 1 < this.heightTiles && this.canStand(currentNode.x, currentNode.y)) {
                       // Assume that we can fall through bricks, but with a higher cost.
                       addNeighbor(currentNode.x, currentNode.y + 1, brickCost);
                   }
                   else if (!this.canStand(currentNode.x, currentNode.y)) {
                       // Falling has a lower cost.
                       addNeighbor(currentNode.x, currentNode.y + 1, fallCost);
                   }

                   if (this.canClimbUp(currentNode.x, currentNode.y)) {
                       addNeighbor(currentNode.x, currentNode.y - 1, 1);
                   }

                   neighbors.forEach(n => {
                       // If a neighbor has already been explored, ignore it.
                       if (closedList.some(v => v.x === n.x && v.y === n.y)) {
                           return;
                       }

                       // Check if a neighbor is already in the list of nodes to explore.
                       let other = openList.find(v => v.x === n.x && v.y === n.y);
                       if (!other) {
                           // If not, add the current neighbor to the list.
                           openList.push(n);
                       }
                       else if (other.cost > n.cost) {
                           // If the current neighbor is already in the list of nodes to explore
                           // and it improves the cost, update the cost and the link to the previous node.
                           other.cost = n.cost;
                           other.prev = n.prev;
                       }
                   });

                   // Sort the open list by increasing estimated path length.
                   openList.sort((a, b) => (a.cost + a.distance) - (b.cost + b.distance));
               }

               for (let node = currentNode; node.prev; node = node.prev) {
                   currentMap[node.prev.y][node.prev.x] = {
                       hint: node.x < node.prev.x ? 'L' :
                             node.x > node.prev.x ? 'R' :
                             node.y < node.prev.y ? 'U' :
                             node.y > node.prev.y && (this.canHang(node.prev.x, node.prev.y) || this.canClimbDown(node.prev.x, node.prev.y)) ? 'D' : 'F',
                       distance: currentMap[node.y][node.x].distance + (node.cost - node.prev.cost)
                   };
               }
           }));
       });

       return result;
   },

   loop() {
        // Loop this function every 60 ms
        requestAnimationFrame(() => this.loop());
        this.update();
    },

    onKeyChange(evt, down) {
        for (let key in KEYS) {
            if (KEYS[key].indexOf(evt.key) >= 0) {
                this.player.commands[key] = down;
                evt.preventDefault();
                evt.stopPropagation();
                return;
            }
        }
    },

    update() {
        this.player.update();
        this.robots.forEach(r => r.update());
        this.renderer.render(this.stage);
    },

    xPixToTile(x) {
        return Math.floor(x / TILE_WIDTH_PX);
    },

    yPixToTile(y) {
        return Math.floor(y / TILE_HEIGHT_PX);
    },

    xTileToPix(x) {
        return (x + 0.5) * TILE_WIDTH_PX;
    },

    yTileToPix(y) {
        return (y + 0.5) * TILE_HEIGHT_PX;
    },

    getTileType(x, y) {
        const symbol = this.rows[y][x];
        if (symbol in SYMBOLS) {
            return SYMBOLS[symbol];
        }
        return "empty";
    },

    // TODO move this to human
    getDistanceToTarget(x, y, g) {
        return this.humanHints[this.targets.indexOf(g)][y][x].distance;
    },

    getNearestTarget(x, y) {
        return this.targets.filter(g => g.active).reduce((a, b) => {
            return this.getDistanceToTarget(x, y, a) < this.getDistanceToTarget(x, y, b) ?
                a : b;
        });
    },

    // TODO move this to robot
    getHint(x, y) {
        // Find if a path to the player is available.
        let target = this.targets.find((t, i) => {
            let rx = x;
            let ry = y;
            // Limit the path length.
            for (let j = 0; j < this.widthTiles + this.heightTiles; j ++) {
                // If the current path passes by the player location, OK.
                if (rx === this.player.xTile && ry === this.player.yTile) {
                    return true;
                }
                // Else, check next location along the current path.
                switch (this.robotHints[i][ry][rx].hint) {
                    case 'L': rx --; break;
                    case 'R': rx ++; break;
                    case 'U': ry --; break;
                    case 'D':
                    case 'F': ry ++; break;
                    default: return false;
                }
            }
            return false;
        });

        // If no path was found, then move to the current target of the player.
        if (!target) {
            target = this.player.nearestTarget;
        }

        // If no target was found, don't move at all.
        if (!target) {
            return 'X';
        }

        return this.robotHints[this.targets.indexOf(target)][y][x].hint;
    },

    canMoveLeft(x, y) {
        return x > 0 && this.getTileType(x - 1, y) !== "brick";
    },

    canMoveRight(x, y) {
        return x + 1 < this.widthTiles && this.getTileType(x + 1, y) !== "brick";
    },

    canStand(x, y) {
        return y + 1 === this.heightTiles ||
               this.getTileType(x, y + 1) === "brick" ||
               this.getTileType(x, y + 1) === "ladder";
    },

    canHang(x, y) {
        return this.getTileType(x, y) === "rope";
    },

    canClimbUp(x, y) {
        return this.getTileType(x, y) === "ladder";
    },

    canClimbDown(x, y) {
        return y + 1 < this.heightTiles && this.getTileType(x, y + 1) === "ladder";
    },

    canBreakLeft(x, y) {
        return y + 1 < this.heightTiles && x > 0 && this.getTileType(x - 1, y + 1) === "brick";
    },

    canBreakRight(x, y) {
        return y + 1 < this.heightTiles && x + 1 < this.widthTiles && this.getTileType(x + 1, y + 1) === "brick";
    },

    removeTile(x, y) {
        let symbol = this.rows[y][x];
        let tile = this.tiles[y][x];

        // Remove the current tile.
        this.rows[y][x] = ' ';
        tile.visible = false;

        return [symbol, tile];
    },

    breakBrick(x, y) {
        let [symbol, tile] = this.removeTile(x, y);

        this.recomputeHints();

        // Show it again after a given delay.
        window.setTimeout(() => {
            this.rows[y][x] = symbol;
            tile.visible = true;

            if (this.player.xTile === x && this.player.yTile === y) {
                this.player.moveToEmptyLocation(x, y);
            }

            this.robots.forEach(r => {
                if (r.xTile === x && r.yTile === y) {
                    r.moveToEmptyLocation(x, y);
                }
            });

            this.recomputeHints();
        }, TILE_HIDE_DELAY_MS);
    },

    collectGift(x, y) {
        const g = this.gifts.find(g => g.x === x && g.y === y);
        if (!g) {
            return;
        }
        g.active = false;
        this.remainingGifts --;
        this.rows[y][x] = ' ';
        let tile = this.tiles[y][x];
        tile.x = (this.widthTiles  - 0.5) * TILE_WIDTH_PX - this.remainingGifts * (TILE_WIDTH_PX + MARGIN) - MARGIN;
        tile.y = (this.heightTiles + 0.5) * TILE_HEIGHT_PX + MARGIN;
    }
};
