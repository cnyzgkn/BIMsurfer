define([
    "bimsurfer/src/DefaultMaterials.js",
    "bimsurfer/src/EventHandler.js",
    "bimsurfer/src/xeoViewer/controls/bimCameraControl.js",
    "bimsurfer/src/xeoViewer/entities/bimModel.js",
    "bimsurfer/src/xeoViewer/entities/bimObject.js",
    "bimsurfer/src/xeoViewer/helpers/bimBoundaryHelper.js",
    "bimsurfer/src/xeoViewer/helpers/bimAxisHelper.js"
], function (DefaultMaterials, EventHandler) {

    "use strict";

    function xeoViewer(cfg) {

        // Distance to WebGL's far clipping plane.
        const FAR_CLIP = 5000;

        // Create xeoViewer

        EventHandler.call(this);

        var self = this;

        var domNode = document.getElementById(cfg.domNode);
        var canvas = document.createElement("canvas");

        domNode.appendChild(canvas);

        // Create a Scene
        var scene = new XEO.Scene({ // http://xeoengine.org/docs/classes/Scene.html
            canvas: canvas
        });

        // Redefine default light sources;
        scene.lights.lights = [

            new XEO.AmbientLight(scene, {
                color: [0.65, 0.65, 0.75],
                intensity: 1.0
            }),

            new XEO.DirLight(scene, {
                dir: [0.0, 0.0, -1.0],
                color: [1.0, 1.0, 1.0],
                intensity: 1.0,
                space: "view"
            })
        ];

        // Attached to all objects to fit the model inside the view volume
        var scale = new XEO.Scale(scene, {
            xyz: [1, 1, 1]
        });

        // Provides user input
        var input = scene.input;

        // Using the scene's default camera
        var camera = scene.camera;
        camera.project.far = FAR_CLIP;

        // Flies cameras to objects
        var cameraFlight = new XEO.CameraFlight(scene); // http://xeoengine.org/docs/classes/CameraFlight.html

        // Registers loaded xeoEngine components for easy destruction
        var collection = new XEO.Collection(scene); // http://xeoengine.org/docs/classes/Collection.html

        // Shows a wireframe box at the given boundary
        var boundaryHelper = new XEO.BIMBoundaryHelper(scene);

        // Shows a gnomon which indicates the directions of the World-space coordinate axis
        var axisHelper = new XEO.BIMAxisHelper({
            lookat: camera.view,
            visible: true,
            size: [200, 200]
        });

        // Models mapped to their IDs
        var models = {};

        // Objects mapped to IDs
        var objects = {};

        // For each RFC type, a map of objects mapped to their IDs
        var rfcTypes = {};

        // Objects that are currently visible, mapped to IDs
        var visibleObjects = {};

        // Lazy-generated array of visible object IDs, for return by #getVisibility()
        var visibleObjectList = null;

        // Objects that are currently selected, mapped to IDs
        var selectedObjects = {};

        // Lazy-generated array of selected object IDs, for return by #getSelection()
        var selectedObjectList = null;

        // Bookmark of initial state to reset to - captured with #saveReset(), applied with #reset().
        var resetBookmark = null;

        // Component for each projection type,
        // to swap on the camera when we switch projection types
        var projections = {

            persp: camera.project, // Camera has a XEO.Perspective by default

            ortho: new XEO.Ortho(scene, {
                scale: 1.0,
                near: 0.1,
                far: FAR_CLIP
            })
        };

        // The current projection type
        var projectionType = "persp";

        //-----------------------------------------------------------------------------------------------------------
        // Camera notifications
        //-----------------------------------------------------------------------------------------------------------

        (function () {

            // Fold xeoEngine's separate events for view and projection updates
            // into a single "camera-changed" event, deferred to fire on next scene tick.

            var cameraUpdated = false;

            camera.on("projectMatrix",
                function () {
                    cameraUpdated = true;
                });

            camera.on("viewMatrix",
                function () {
                    cameraUpdated = true;
                });

            scene.on("tick",
                function () {

                    /**
                     * Fired on the iteration of each "game loop" for this xeoViewer.
                     * @event tick
                     * @param {String} sceneID The ID of this Scene.
                     * @param {Number} startTime The time in seconds since 1970 that this xeoViewer was instantiated.
                     * @param {Number} time The time in seconds since 1970 of this "tick" event.
                     * @param {Number} prevTime The time of the previous "tick" event from this xeoViewer.
                     * @param {Number} deltaTime The time in seconds since the previous "tick" event from this xeoViewer.
                     */
                    self.fire("tick");

                    if (cameraUpdated) {

                        /**
                         * Fired whenever this xeoViewer's camera changes.
                         * @event camera-changed
                         * @params New camera state, same as that got with #getCamera.
                         */
                        self.fire("camera-changed", [self.getCamera()]);
                        cameraUpdated = false;
                    }
                });
        })();

        //-----------------------------------------------------------------------------------------------------------
        // Camera control
        //-----------------------------------------------------------------------------------------------------------

        var cameraControl = new XEO.BIMCameraControl(scene, {
            camera: camera
        });

        cameraControl.on("pick",
            function (hit) {

                // Get BIM object ID from entity metadata

                var entity = hit.entity;

                if (!entity.meta) {
                    return;
                }

                var objectId = entity.meta.objectId;

                if (objectId === undefined) {
                    return;
                }

                var selected = !!selectedObjects[objectId]; // Object currently selected?
                var shiftDown = scene.input.keyDown[input.KEY_SHIFT]; // Shift key down?

                self.setSelection({
                    ids: [objectId],
                    selected: !selected, // Picking an object toggles its selection status
                    clear: !shiftDown // Clear selection first if shift not down
                });
            });

        cameraControl.on("nopick",
            function (hit) {
                self.setSelection({
                    clear: true
                });
            });

        /**
         * Sets the global scale for models loaded into the viewer.
         *
         * @method setScale
         * @param {Number} s Scale factor.
         */
        this.setScale = function (s) {
            scale.xyz = [s, s, s];
        };

        /**
         * Loads random objects into the viewer for testing.
         *
         * Subsequent calls to #reset will then set the viewer to the state right after the model was loaded.
         *
         * @method loadRandom
         * @param {*} params Parameters
         * @param {Number} [params.numEntities=200] Number of entities to create.
         * @param {Number} [params.size=200] Size of model on every axis.
         */
        this.loadRandom = function (params) {

            params = params || {};

            this.clear();

            var geometry = new XEO.BoxGeometry(scene, { // http://xeoengine.org/docs/classes/Geometry.html
                id: "geometry.myGeometry"
            });

            collection.add(geometry);

            var roid = "foo";
            var oid;
            var type;
            var objectId;
            var translate;
            var scale;
            var matrix;
            var types = Object.keys(DefaultMaterials);

            var numEntities = params.numEntities || 200;
            var size = params.size || 200;
            var halfSize = size / 2;

            for (var i = 0; i < numEntities; i++) {
                objectId = "object" + i;
                oid = objectId;
                translate = XEO.math.translationMat4c(Math.random() * size - halfSize, Math.random() * size - halfSize, Math.random() * size - halfSize);
                scale = XEO.math.scalingMat4c(Math.random() * 32 + 0.2, Math.random() * 32 + 0.2, Math.random() * 10 + 0.2);
                matrix = XEO.math.mulMat4(translate, scale);
                type = types[Math.round(Math.random() * types.length)];
                this.createObject(roid, oid, objectId, ["myGeometry"], type, matrix);
            }

            this.viewFit();

            this.saveReset();
        };

        /**
         * Creates a geometry.
         *
         * @method createGeometry
         * @param geometryId
         * @param positions
         * @param normals
         * @param colors
         * @param indices
         * @private
         */
        this.createGeometry = function (geometryId, positions, normals, colors, indices) {
            var geometry = new XEO.Geometry(scene, { // http://xeoengine.org/docs/classes/Geometry.html
                id: "geometry." + geometryId,
                primitive: "triangles",
                positions: positions,
                normals: normals,
                colors: colors,
                indices: indices
            });

            collection.add(geometry);
        };


        /**
         * Creates a model.
         *
         * @param modelId
         * @returns {XEO.BIMModel} The new model
         * @private
         */
        this.createModel = function (modelId) {

            if (models[modelId]) {
                console.log("Model with id " + modelId + " already exists, won't recreate");
                return;
            }

            var model = new XEO.BIMModel(scene, {});

            models[modelId] = model;

            collection.add(model);

            return model;
        };

        /**
         * Creates an object.
         * @param [modelId] Optional model ID
         * @param roid
         * @param oid
         * @param objectId
         * @param geometryIds
         * @param type
         * @param matrix
         * @private
         */
        this.createObject = function (modelId, roid, oid, objectId, geometryIds, type, matrix) {

            if (modelId) {
                var model = models[modelId];
                if (!model) {
                    console.log("Can't create object - model not found: " + modelId);
                    return;
                }
                objectId = modelId + ":" + objectId;
            }

            if (objects[objectId]) {
                console.log("Object with id " + objectId + " already exists, won't recreate");
                return;
            }

            var object = new XEO.BIMObject(scene, {
                id: objectId,
                geometryIds: geometryIds,
                matrix: matrix
            });

            object.transform.parent = scale; // Apply model scaling

            this._addObject(type, object);

            if (model) {
                model.collection.add(object);
            }

            return object;
        };

        /**
         * Inserts an object into this viewer
         *
         * @param {String} type
         * @param {XEO.Entity | XEO.BIMObject} object
         * @private
         */
        this._addObject = function (type, object) {

            collection.add(object);

            // Register object against ID
            objects[object.id] = object;

            // Register object against IFC type
            var types = (rfcTypes[type] || (rfcTypes[type] = {}));
            types[object.id] = object;

            var color = DefaultMaterials[type] || DefaultMaterials["DEFAULT"];

            object.material.diffuse = [color[0], color[1], color[2]];
            object.material.specular = [0, 0, 0];

            if (color[3] < 1) { // Transparent object
                object.material.opacity = color[3];
                object.modes.transparent = true;
            }
        };

        /**
         * Loads glTF model.
         *
         * Subsequent calls to #reset will then set the viewer to the state right after the model was loaded.
         *
         * @param src
         */
        this.loadglTF = function (src) {

            this.clear();

            var model = new XEO.Model(scene, {
                src: src
            });

            collection.add(model);

            models[model.id] = model;

            model.on("loaded",
                function () {

                    // TODO: viewFit, but boundaries not yet ready on Model Entities

                    model.collection.iterate(function (component) {
                        if (component.isType("XEO.Entity")) {
                            self._addObject("DEFAULT", component);
                        }
                    });

                    self.saveReset();
                });
        };

        /**
         * Destroys a model and all its objects.
         *
         * @param modelId
         */
        this.destroyModel = function (modelId) {

            var model = models[modelId];

            if (!model) {
                console.warn("Can't destroy model - model not found: " + modelId);
                return;
            }

            model.collection.iterate(function (component) {
                component.destroy();
            });

            model.destroy();

            delete models[modelId];
        };

        /**
         * Clears the viewer.
         *
         * Subsequent calls to #reset will then set the viewer this clear state.
         */
        this.clear = function () {

            var list = [];

            collection.iterate(
                function (component) {
                    list.push(component);
                });

            while (list.length) {
                list.pop().destroy();
            }

            objects = {};
            rfcTypes = {};
            visibleObjects = {};
            visibleObjectList = null;
            selectedObjects = {};
            selectedObjectList = null;

            this.saveReset();
        };

        /**
         * Sets the visibility of objects specified by ID or IFC type.
         *
         * @param params
         * @param params.ids IDs of objects or IFC types to update.
         * @param params.color Color to set.
         */
        this.setVisibility = function (params) {

            var changed = false; // Only fire "visibility-changed" when visibility updates are actually made
            params = params || {};

            var ids = params.ids;
            var types = params.types;

            if (!ids && !types) {
                console.error("Param expected: ids or types");
                return;
            }

            ids = ids || [];
            types = types || [];

            //var recursive = !!params.recursive;
            var visible = params.visible !== false;

            var i;
            var len;
            var id;
            var objectId;
            var object;

            if (params.clear) {
                for (objectId in visibleObjects) {
                    if (visibleObjects.hasOwnProperty(objectId)) {
                        delete visibleObjects[objectId];
                        changed = true;
                    }
                }
            }

            for (i = 0, len = types.length; i < len; i++) {
                var typedict = rfcTypes[types[i]] || {};
                debugger;
                Object.keys(typedict).forEach(function (id) {
                    var object = typedict[id];
                    object.visibility.visible = visible;
                    changed = true;
                });
            }

            for (i = 0, len = ids.length; i < len; i++) {
                id = ids[i];
                object = objects[id];
                if (!object) {
                    console.error("RFC type or object not found: '" + id + "'");
                } else {
                    object.visibility.visible = visible;
                    changed = true;
                }
            }

            if (changed) {
                visibleObjectList = Object.keys(visibleObjects);

                /**
                 * Fired whenever objects become invisible or invisible
                 * @event visibility-changed
                 * @params Array of IDs of all currently-visible objects.
                 */
                this.fire("visibility-changed", [visibleObjectList]);
            }
        };

        /**
         * Returns array of IDs of objects that are currently visible
         */
        this.getVisibility = function () {
            if (visibleObjectList) {
                return visibleObjectList;
            }
            visibleObjectList = Object.keys(visibleObjects);
            return visibleObjectList;
        };

        /**
         * Select or deselect some objects.
         *
         * @param params
         * @param params.ids IDs of objects.
         * @param params.selected Whether to select or deselect the objects
         * @param params.clear Whether to clear selection state prior to updating
         */
        this.setSelection = function (params) {

            params = params || {};

            var changed = false; // Only fire "selection-changed" when selection actually changes
            var selected = !!params.selected;
            var objectId;
            var object;

            if (params.clear) {
                for (objectId in selectedObjects) {
                    if (selectedObjects.hasOwnProperty(objectId)) {
                        delete selectedObjects[objectId];
                        changed = true;
                    }
                }
            }

            var ids = params.ids;

            if (ids) {

                for (var i = 0, len = ids.length; i < len; i++) {

                    objectId = ids[i];
                    object = objects[objectId];

                    if (!object) {
                        console.error("Object not found: '" + objectId + "'");

                    } else {

                        if (!!selectedObjects[objectId] !== selected) {
                            changed = true;
                        }

                        if (selected) {
                            selectedObjects[objectId] = object;
                        } else {
                            if (selectedObjects[objectId]) {
                                delete selectedObjects[objectId];
                            }
                        }

                        selectedObjectList = null; // Now needs lazy-rebuild
                    }
                }
            }

            if (changed) {

                selectedObjectList = Object.keys(selectedObjects);

                // Show boundary around selected objects
                setBoundaryState({
                    ids: selectedObjectList,
                    show: selectedObjectList.length > 0
                });

                /**
                 * Fired whenever this xeoViewer's selection state changes.
                 * @event selection-changed
                 * @params Array of IDs of all currently-selected objects.
                 */
                this.fire("selection-changed", [selectedObjectList]);
            }
        };

        /**
         * Returns array of IDs of objects that are currently selected
         */
        this.getSelection = function () {
            if (selectedObjectList) {
                return selectedObjectList;
            }
            selectedObjectList = Object.keys(selectedObjects);
            return selectedObjectList;
        };

        /**
         * Sets the color of objects specified by IDs.
         *
         * @param params
         * @param params.ids IDs of objects to update.
         * @param params.color Color to set.
         */
        this.setColor = function (params) {

            params = params || {};

            var ids = params.ids;

            if (!ids) {
                console.error("Param expected: 'ids'");
                return;
            }

            var color = params.color;

            if (!color) {
                console.error("Param expected: 'color'");
                return;
            }

            var objectId;
            var object;

            for (var i = 0, len = ids.length; i < len; i++) {

                objectId = ids[i];
                object = objects[objectId];

                if (!object) {
                    // No return on purpose to continue changing color of
                    // other potentially valid object identifiers.
                    console.error("Object not found: '" + objectId + "'");
                } else {
                    this._setObjectColor(object, color);
                }
            }
        };

        this._setObjectColor = function (object, color) {

            var material = object.material;
            material.diffuse = [color[0], color[1], color[2]];

            var opacity = (color.length > 3) ? color[3] : 1;
            if (opacity !== material.opacity) {
                material.opacity = opacity;
                object.modes.transparent = opacity < 1;
            }
        };

        /**
         * Sets camera state.
         *
         * @param params
         */
        this.setCamera = function (params) {

            params = params || {};

            // Set projection type

            var type = params.type;

            if (type && type !== projectionType) {

                var projection = projections[type];

                if (!projection) {
                    console.error("Unsupported camera projection type: " + type);
                } else {
                    camera.project = projection;
                    projectionType = type;
                }
            }

            // Set camera position

            if (params.animate) {

                cameraFlight.flyTo({
                    eye: params.eye,
                    look: params.target,
                    up: params.up
                });

            } else {

                if (params.eye) {
                    camera.view.eye = params.eye;
                }

                if (params.target) {
                    camera.view.look = params.target;
                    cameraControl.rotatePos = camera.view.look; // Rotate about target initially
                }

                if (params.up) {
                    camera.view.up = params.up;
                }
            }

            // Set camera FOV angle, only if currently perspective

            if (params.fovy) {
                if (projectionType !== "persp") {
                    console.error("Ignoring update to 'fovy' for current '" + projectionType + "' camera");
                } else {
                    camera.project.fovy = params.fovy;
                }
            }

            // Set camera view volume size, only if currently orthographic

            if (params.scale) {
                if (projectionType !== "ortho") {
                    console.error("Ignoring update to 'scale' for current '" + projectionType + "' camera");
                } else {
                    camera.project.scale = params.scale;
                }
            }
        };

        /**
         * Gets camera state.
         *
         * @returns {{type: string, eye: (*|Array.<T>), target: (*|Array.<T>), up: (*|Array.<T>)}}
         */
        this.getCamera = function () {

            var view = camera.view;

            var json = {
                type: projectionType,
                eye: view.eye.slice(0),
                target: view.look.slice(0),
                up: view.up.slice(0)
            };

            var project = camera.project;

            if (projectionType === "persp") {
                json.fovy = project.fovy;

            } else if (projectionType === "ortho") {
                json.size = [1, 1, 1]; // TODO: efficiently derive from cached value or otho volume
            }

            return json;
        };

        /**
         *
         * @param params
         * @param ok
         */
        this.viewFit = function (params, ok) {

            params = params || {};

            var ids = params.ids;
            var aabb;

            if (!ids || ids.length === 0) {

                // Fit everything in view by default
                aabb = scene.worldBoundary.aabb;

            } else {
                aabb = getObjectsAABB(ids);
            }

            if (params.animate) {

                // Show the boundary we are flying to
                //boundaryHelper.geometry.aabb = aabb;
                //boundaryHelper.visibility.visible = true;

                cameraFlight.flyTo({aabb: aabb, stopFOV: 20},
                    function () {

                        // Hide the boundary again
                        //boundaryHelper.visibility.visible = false;

                        if (ok) {
                            ok();
                        }

                        // Now orbiting the point we flew to
                        cameraControl.rotatePos = camera.view.look;
                    });

            } else {

                cameraFlight.jumpTo({aabb: aabb, stopFOV: 20});
            }
        };

        // Updates the boundary helper
        function setBoundaryState(params) {

            if (params.aabb) {
                boundaryHelper.geometry.aabb = params.aabb;

            } else if (params.ids) {
                boundaryHelper.geometry.aabb = getObjectsAABB(params.ids);
            }

            boundaryHelper.visibility.visible = !!params.show;
        }

        // Returns an axis-aligned bounding box (AABB) that encloses the given objects
        function getObjectsAABB(ids) {

            if (ids.length === 0) {

                // No object IDs given
                return null;
            }

            var objectId;
            var object;
            var worldBoundary;

            if (ids.length === 1) {

                // One object ID given

                objectId = ids[0];
                object = objects[objectId];

                if (object) {
                    worldBoundary = object.worldBoundary;

                    if (worldBoundary) {

                        return worldBoundary.aabb;

                    } else {
                        return null;
                    }

                } else {
                    return null;
                }
            }

            // Many object IDs given

            var i;
            var len;
            var min;
            var max;

            var xmin = 100000;
            var ymin = 100000;
            var zmin = 100000;
            var xmax = -100000;
            var ymax = -100000;
            var zmax = -100000;

            var aabb;

            for (i = 0, len = ids.length; i < len; i++) {

                objectId = ids[i];
                object = objects[objectId];

                if (!object) {
                    continue;
                }

                worldBoundary = object.worldBoundary;

                if (!worldBoundary) {
                    continue;
                }

                aabb = worldBoundary.aabb;

                min = aabb.min;
                max = aabb.max;

                if (min[0] < xmin) {
                    xmin = min[0];
                }

                if (min[1] < ymin) {
                    ymin = min[1];
                }

                if (min[2] < zmin) {
                    zmin = min[2];
                }

                if (max[0] > xmax) {
                    xmax = max[0];
                }

                if (max[1] > ymax) {
                    ymax = max[1];
                }

                if (max[2] > zmax) {
                    zmax = max[2];
                }
            }

            var result = XEO.math.AABB3();

            result.min[0] = xmin;
            result.min[1] = ymin;
            result.min[2] = zmin;
            result.max[0] = xmax;
            result.max[1] = ymax;
            result.max[2] = zmax;

            return result;
        }

        /**
         * Remembers the current state of the viewer so that it can be reset to this state with
         * a subsequent call to #reset.
         */
        this.saveReset = function () {
            resetBookmark = this.getBookmark();
        };

        /**
         * Resets the state of this viewer to the state previously saved with #saveReset.
         * @param {*} params A mask which specifies which aspects of viewer state to reset.
         */
        this.reset = function (params) {
            if (!resetBookmark) {
                console.log("Ignoring call to xeoViewer.reset - xeoViewer.saveReset not called previously.");
                return;
            }
            this.setBookmark(resetBookmark, params);
        };

        /**
         * Returns a bookmark of xeoViewer state.
         * @param {*} options A mask which specifies which aspects of viewer state to bookmark.
         */
        this.getBookmark = function (options) {

            // Get everything by default

            var getVisible = !options || options.visible;
            var getColors = !options || options.colors;
            var getSelected = !options || options.selected;
            var getCamera = !options || options.camera;

            var bookmark = {};

            var objectId;
            var object;

            if (getVisible) {

                var visible = [];

                for (objectId in objects) {
                    if (objects.hasOwnProperty(objectId)) {

                        object = objects[objectId];

                        if (getVisible && object.visibility.visible) {
                            visible.push(objectId);
                        }
                    }
                }
                bookmark.visible = visible;
            }

            if (getColors) {

                var opacity;
                var colors = {};

                for (objectId in objects) {
                    if (objects.hasOwnProperty(objectId)) {
                        object = objects[objectId];
                        opacity = object.modes.transparent ? object.material.opacity : 1.0;
                        colors[objectId] = object.material.diffuse.slice(0).concat(opacity); // RGBA
                    }
                }
                bookmark.colors = colors;
            }

            if (getSelected) {
                bookmark.selected = this.getSelection();
            }

            if (getCamera) {
                var camera = this.getCamera();
                camera.animate = true; // Camera will fly to position when bookmark is restored
                bookmark.camera = camera;
            }

            return bookmark;
        };

        /**
         * Restores xeoViewer to a bookmark.
         *
         * @param bookmark
         * @param options
         */
        this.setBookmark = function (bookmark, options) {

            // Set everything by default, where provided in bookmark

            var setVisible = bookmark.visible && (!options || options.visible);
            var setColors = bookmark.colors && (!options || options.colors);
            var setSelected = bookmark.selected && (!options || options.selected);
            var setCamera = bookmark.camera && (!options || options.camera);

            if (setColors) {

                var objectId;
                var object;
                var colors = bookmark.colors;

                for (objectId in colors) {
                    if (colors.hasOwnProperty(objectId)) {
                        object = objects[objectId];
                        if (object) {
                            this._setObjectColor(object, colors[objectId]);
                        }
                    }
                }
            }

            if (setVisible) {
                this.setVisibility({
                    ids: bookmark.visible,
                    visible: true
                });
            }

            if (setSelected) {
                this.setSelection({
                    ids: bookmark.selected,
                    selected: true
                });
            }

            if (setCamera) {
                this.setCamera(bookmark.camera);
            }
        };

        /**
         * Set general configurations
         *
         * @param params
         * @param {Boolean} [params.mouseRayPick=true] When true, camera flies to orbit each clicked point, otherwise
         * it flies to the boundary of the object that was clicked on.
         * @param {Number} [params.mouseRayPick=true] When true, camera flies to orbit each clicked point, otherwise
         */
        this.setConfigs = function (params) {

            params = params || {};

            if (params.mouseRayPick != undefined) {
                cameraControl.mousePickEntity.rayPick = params.mouseRayPick;
            }
        };

        /**
         Returns a snapshot of this xeoViewer as a Base64-encoded image.

         #### Usage:
         ````javascript
         imageElement.src = xeoViewer.getSnapshot({
             width: 500, // Defaults to size of canvas
             height: 500,
             format: "png" // Options are "jpeg" (default), "png" and "bmp"
         });
         ````

         @method getSnapshot
         @param {*} [params] Capture options.
         @param {Number} [params.width] Desired width of result in pixels - defaults to width of canvas.
         @param {Number} [params.height] Desired height of result in pixels - defaults to height of canvas.
         @param {String} [params.format="jpeg"] Desired format; "jpeg", "png" or "bmp".
         @returns {String} String-encoded image data.
         */
        this.getSnapshot = function (params) {
            return scene.canvas.getSnapshot(params);
        };
    }

    xeoViewer.prototype = Object.create(EventHandler.prototype);

    return xeoViewer;
});